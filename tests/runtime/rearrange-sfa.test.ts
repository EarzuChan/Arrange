import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import * as runtime from '../../packages/runtime/src/index.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { recordingNative } from './recordingNative.ts'

function evaluateSfa(source: string, state: object = {}) {
    const { code } = compileArrangeSfa(source, '重排验收.sfa')
    assert.doesNotMatch(code, /createVNode|createBlock|arrangeValue|LayoutRearrangeNode/)
    const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { default?: runtime.ArrangableDefinition } = {}
    new Function('require', 'exports', output)((name: string) => name === './state' ? state : runtime, exports)
    return exports.default!
}

test('真实 SFA 纯值变化只更新文本 Modifier，不执行结构且保留 Layout 身份', async () => {
    const title = runtime.ref('旧值')
    const Root = evaluateSfa('<template><Text :text="title" /></template><script>import { title } from "./state"</script>', { title })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const initial = native.textNodes()
    assert.equal(initial[0].text, '旧值')
    const structures = runtime.getArrangeExecutionStats().structureRuns

    title.value = '新值'
    await runtime.nextTick()
    assert.deepEqual(native.textNodes(), [{ id: initial[0].id, text: '新值' }])
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, structures)
    app.unmount()
})

test('用户 SFA 直接组合 Layout、Policy 与文本 Modifier，结果等同代码 FA', () => {
    const Page = evaluateSfa('<template><Layout :measurePolicy="BoxMeasurePolicy()" :modifier="M.padding(8)"><Layout :measurePolicy="MinSizeMeasurePolicy" :modifier="M.text(\'正文\')" /></Layout></template><script>import { Layout, BoxMeasurePolicy, MinSizeMeasurePolicy, M } from "@arrange/framework"</script>')
    const Code = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.Box, { modifier: () => runtime.M.padding(8) }, { default: () => call(0, runtime.Text, { text: () => '正文' }) }) })
    const collect = (definition: runtime.ArrangableDefinition) => {
        const native = recordingNative()
        const app = runtime.createApp(definition)
        app.mount(native.target)
        const result = JSON.parse(JSON.stringify([...native.nodes.values()].map(node => ({ id: node.id, children: node.children, policy: node.inputs.get('measurePolicy'), modifier: node.inputs.get('modifier') }))))
        app.unmount()
        return result
    }
    assert.deepEqual(collect(Page), collect(Code))
})

test('退出未再访问的对象参数绑定取消订阅，恢复后重新读取最新对象', async () => {
    const shown = runtime.ref(true)
    const text = runtime.ref('旧内容')
    let reads = 0
    const Page = runtime.defineArrangable({ setup: (_props, { call }) => () => {
        if (shown.value) call(0, runtime.Text, runtime.parameterInputs(runtime.parameterObject(0, () => {
            reads++
            return { text: text.value }
        })))
    } })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    app.mount(native.target)
    shown.value = false
    await runtime.nextTick()
    const stoppedReads = reads
    text.value = '新内容'
    await runtime.nextTick()
    assert.equal(reads, stoppedReads)
    shown.value = true
    await runtime.nextTick()
    assert.equal(native.textNodes()[0].text, '新内容')
    app.unmount()
})

test('真实 SFA keyed 列表移动刷新索引并保留各项 Layout 身份', async () => {
    const items = runtime.ref([{ id: 'A' }, { id: 'B' }])
    const Root = evaluateSfa('<template><Column><Text v-for="(item, index) in items" :key="item.id" :text="item.id + index" /></Column></template><script>import { items } from "./state"</script>', { items })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const initial = native.textNodes()
    assert.deepEqual(initial.map(node => node.text), ['A0', 'B1'])

    items.value = [items.value[1], items.value[0]]
    await runtime.nextTick()
    assert.deepEqual(native.textNodes(), [{ id: initial[1].id, text: 'B0' }, { id: initial[0].id, text: 'A1' }])
    app.unmount()
})

test('真实 SFA 中间条件与单条目条件独立重启，根及无关兄弟保持不执行', async () => {
    const rows = runtime.ref([{ id: '甲', shown: true, title: '甲内容' }, { id: '乙', shown: true, title: '乙内容' }])
    const middleShown = runtime.ref(true)
    let rootRuns = 0
    let listRuns = 0
    const conditionRuns = new Map<string, number>()
    const rootKey = () => { rootRuns++; return '根位置' }
    const readRows = () => { listRuns++; return rows.value }
    const visible = (row: typeof rows.value[number]) => {
        conditionRuns.set(row.id, (conditionRuns.get(row.id) ?? 0) + 1)
        return row.shown
    }
    const Page = evaluateSfa('<template><Text :key="rootKey()" text="固定"/><Spacer v-if="middleShown"/><Template v-for="row in readRows()" :key="row.id"><Text v-if="visible(row)" :text="row.title"/></Template></template><script>import { rootKey, readRows, visible, middleShown } from "./state"</script>', { rootKey, readRows, visible, middleShown })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    app.mount(native.target)
    const before = runtime.getArrangeExecutionStats()
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 1, 1])

    middleShown.value = false
    await runtime.nextTick()
    assert.equal(runtime.getArrangeExecutionStats().structureRuns - before.structureRuns, 1)
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 1, 1])

    rows.value[0].shown = false
    await runtime.nextTick()
    assert.equal(runtime.getArrangeExecutionStats().structureRuns - before.structureRuns, 2)
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 2, 1])
    rows.value[1].title = '乙更新'
    await runtime.nextTick()
    assert.equal(runtime.getArrangeExecutionStats().structureRuns - before.structureRuns, 2)
    assert.deepEqual(native.textNodes().map(node => node.text), ['固定', '乙更新'])
    app.unmount()
})

test('真实 SFA 空分支、多根与重复内容调用维护插入顺序及独立身份', async () => {
    const show = runtime.ref(false)
    const Content = evaluateSfa('<template><Slot/><Slot/></template>')
    const Root = evaluateSfa('<template><Text text="前"/><Template v-if="show"><Text text="中一"/><Text text="中二"/></Template><Content><Text text="内容"/></Content><Text text="后"/></template><script>import { show, Content } from "./state"</script>', { show, Content })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const initial = native.textNodes()
    assert.deepEqual(initial.map(node => node.text), ['前', '内容', '内容', '后'])
    assert.notEqual(initial[1].id, initial[2].id)

    show.value = true
    await runtime.nextTick()
    const next = native.textNodes()
    assert.deepEqual(next.map(node => node.text), ['前', '中一', '中二', '内容', '内容', '后'])
    assert.deepEqual(next.filter(node => node.text === '内容'), initial.filter(node => node.text === '内容'))
    app.unmount()
})


test('对象绑定区分形状和值，字段变化不唤醒结构，移除字段恢复声明默认值', async () => {
    const values = runtime.ref<Record<string, unknown>>({ text: '正文', textStyle: { color: 1 } })
    const Root = evaluateSfa('<template><Text v-bind="values" /></template><script>import { values } from "./state"</script>', { values })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const runs = runtime.getArrangeExecutionStats().structureRuns

    values.value = { text: '更新', textStyle: { color: 2 } }
    await runtime.nextTick()
    assert.equal(native.textNodes()[0].text, '更新')
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, runs)

    values.value = { textStyle: { color: 3 } }
    await runtime.nextTick()
    assert.equal(native.textNodes()[0].text, '')
    app.unmount()
})


test('固定 Modifier 链只重新求值失效分段并精确写入既有实例', async () => {
    const width = runtime.ref(20)
    const color = runtime.ref(1)
    let widths = 0
    let colors = 0
    const readWidth = () => { widths++; return width.value }
    const readColor = () => { colors++; return color.value }
    const Root = evaluateSfa('<template><Box :modifier="M.width(readWidth()).background(readColor())" /></template><script>import { M } from "@arrange/framework"\nimport { readWidth, readColor } from "./state"</script>', { readWidth, readColor })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const chains = runtime.modifierStats.chainWrites
    const instances = runtime.modifierStats.instanceWrites
    assert.equal(widths, 1)
    assert.equal(colors, 1)

    color.value = 2
    await runtime.nextTick()
    assert.equal(widths, 1)
    assert.equal(colors, 2)
    assert.equal(runtime.modifierStats.chainWrites, chains)
    assert.equal(runtime.modifierStats.instanceWrites, instances + 1)
    app.unmount()
})

test('固定 Modifier 链相较完整表达式减少求值及分配，保持相同原生输入', async () => {
    const run = async (expression: string) => {
        const color = runtime.ref(1)
        let widths = 0
        const readWidth = () => { widths++; return 20 }
        const makeModifier = () => runtime.M.width(readWidth()).height(30).padding(4).background(color.value)
        const Page = evaluateSfa(`<template><Spacer :modifier="${expression}"/></template><script>import { M } from "@arrange/framework"; import { color, readWidth, makeModifier } from "./state"</script>`, { color, readWidth, makeModifier })
        const native = recordingNative()
        const app = runtime.createApp(Page)
        app.mount(native.target)
        const initialAllocations = { ...runtime.modifierAllocationStats }
        const initialExecutions = runtime.getArrangeExecutionStats()
        const initialWidths = widths
        for (let index = 2; index <= 21; index++) {
            color.value = index
            await runtime.nextTick()
        }
        const result = {
            chains: runtime.modifierAllocationStats.chains - initialAllocations.chains,
            elementReferences: runtime.modifierAllocationStats.elementReferences - initialAllocations.elementReferences,
            widths: widths - initialWidths,
            structures: runtime.getArrangeExecutionStats().structureRuns - initialExecutions.structureRuns,
        }
        const modifier = native.nodes.get(native.nodes.get(1)!.children[0])!.inputs.get('modifier') as runtime.Modifier
        app.unmount()
        return { result, modifier }
    }
    const fixed = await run('M.width(readWidth()).height(30).padding(4).background(color)')
    const dynamic = await run('makeModifier()')
    assert.deepEqual(fixed.modifier, dynamic.modifier)
    assert.equal(fixed.result.structures, 0)
    assert.equal(dynamic.result.structures, 0)
    assert.equal(fixed.result.widths, 0)
    assert.equal(dynamic.result.widths, 20)
    assert.ok(fixed.result.chains < dynamic.result.chains)
    assert.ok(fixed.result.elementReferences < dynamic.result.elementReferences)
    console.log('固定 Modifier 分段与完整表达式对比：' + JSON.stringify({ fixed: fixed.result, dynamic: dynamic.result }))
})

test('列表词法环境中的固定 Modifier 链保持分段缓存，重排后使用最新条目', async () => {
    const rows = runtime.ref([{ id: '甲', width: 20 }, { id: '乙', width: 30 }])
    const color = runtime.ref(1)
    let widths = 0
    const readWidth = (value: number) => { widths++; return value }
    const Page = evaluateSfa('<template><Spacer v-for="row in rows" :key="row.id" :modifier="M.width(readWidth(row.width)).background(color)" /></template><script>import { M } from "@arrange/framework"; import { rows, color, readWidth } from "./state"</script>', { rows, color, readWidth })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    app.mount(native.target)
    assert.equal(widths, 2)
    color.value = 2
    await runtime.nextTick()
    assert.equal(widths, 2)
    rows.value = [{ id: '乙', width: 40 }, { id: '甲', width: 50 }]
    await runtime.nextTick()
    const children = native.nodes.get(1)!.children
    assert.deepEqual(children.map(id => (native.nodes.get(id)!.inputs.get('modifier') as runtime.Modifier).elements[0].value.value), [40, 50])
    app.unmount()
})


test('KeepAlive 保留调用生命，停用释放原生受体，恢复交付最新输入', async () => {
    const selected = runtime.ref('A')
    const value = runtime.ref('初始')
    let setups = 0
    let disposals = 0
    const Child = runtime.defineArrangable({ setup(_props, { call }) {
        setups++
        runtime.onScopeDispose(() => disposals++)
        return () => call(0, runtime.Text, { text: () => value.value })
    } })
    const Root = evaluateSfa('<template><KeepAlive :cacheKey="selected"><Child v-if="selected === \'A\'"/></KeepAlive></template><script>import { KeepAlive } from "@arrange/framework"; import { selected, Child } from "./state"</script>', { selected, Child })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)
    const oldId = native.textNodes()[0].id

    selected.value = '空'
    await runtime.nextTick()
    assert.deepEqual(native.textNodes(), [])
    assert.equal(disposals, 0)
    value.value = '停用后更新'
    await runtime.nextTick()
    assert.deepEqual(native.textNodes(), [])

    selected.value = 'A'
    await runtime.nextTick()
    assert.equal(native.textNodes()[0].text, '停用后更新')
    assert.notEqual(native.textNodes()[0].id, oldId)
    assert.equal(setups, 1)
    app.unmount()
    assert.equal(disposals, 1)
})


test('KeepAlive 多根内容按 LRU 淘汰，隐藏项与活动项卸载均只释放一次', async () => {
    const selected = runtime.ref('A')
    const events: string[] = []
    const Child = runtime.defineArrangable({ setup(_props, { call }) {
        const identity = selected.value
        events.push(`创建 ${identity}`)
        runtime.onScopeDispose(() => events.push(`释放 ${identity}`))
        return () => {
            call(0, runtime.Text, { text: () => `${identity} 一` })
            call(1, runtime.Text, { text: () => `${identity} 二` })
        }
    } })
    const Root = evaluateSfa('<template><KeepAlive :cacheKey="selected" :max="2"><Child /></KeepAlive></template><script>import { KeepAlive } from "@arrange/framework"; import { selected, Child } from "./state"</script>', { selected, Child })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    app.mount(native.target)

    for (const key of ['B', 'A', 'C', 'B']) {
        selected.value = key
        await runtime.nextTick()
        assert.deepEqual(native.textNodes().map(node => node.text), [`${key} 一`, `${key} 二`])
    }
    assert.deepEqual(events, ['创建 A', '创建 B', '创建 C', '释放 B', '创建 B', '释放 A'])
    app.unmount()
    assert.equal(events.filter(event => event === '释放 B').length, 2)
    assert.equal(events.filter(event => event === '释放 A').length, 1)
    assert.equal(events.filter(event => event === '释放 C').length, 1)
})

test('KeepAlive 恢复失败保留已提交页面，重试恢复同一逻辑实例和最新参数', async () => {
    const selected = runtime.ref('A')
    const value = runtime.ref('初值')
    const errors: unknown[] = []
    const events: string[] = []
    const Child = runtime.defineArrangable({ setup(_props, { call }) {
        const identity = selected.value
        events.push(`创建 ${identity}`)
        runtime.onActivated(() => events.push(`恢复 ${identity}`))
        runtime.onDeactivated(() => events.push(`停用 ${identity}`))
        return () => call(0, runtime.Text, { text: () => `${identity} ${value.value}` })
    } })
    const Root = evaluateSfa('<template><KeepAlive :cacheKey="selected"><Child /></KeepAlive></template><script>import { KeepAlive } from "@arrange/framework"; import { selected, Child } from "./state"</script>', { selected, Child })
    const native = recordingNative(false)
    const app = runtime.createApp(Root)
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.finish()
    selected.value = 'B'
    await runtime.nextTick()
    native.finish()
    const before = native.textNodes()

    selected.value = 'A'
    value.value = '最新'
    await runtime.nextTick()
    assert.deepEqual(native.textNodes(), before)
    native.finish('拒绝恢复')
    assert.deepEqual(native.textNodes(), before)
    assert.deepEqual(events, ['创建 A', '创建 B', '停用 A'])
    assert.equal(errors.length, 1)

    selected.value = 'B'
    await runtime.nextTick()
    native.finish()
    selected.value = 'A'
    await runtime.nextTick()
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['A 最新'])
    assert.deepEqual(events, ['创建 A', '创建 B', '停用 A', '停用 B', '恢复 A'])
    app.unmount()
})

test('卸载尚未应用的候选会取消原生提交并释放候选资源', () => {
    let disposed = 0
    const Root = runtime.defineArrangable({ setup(_props, { call }) {
        runtime.onScopeDispose(() => disposed++)
        return () => call(0, runtime.Text, { text: () => '候选' })
    } })
    const native = recordingNative(false)
    const app = runtime.createApp(Root)
    app.mount(native.target)
    app.unmount()
    assert.equal(disposed, 1)
    assert.deepEqual(native.textNodes(), [])
    assert.throws(() => native.finish(), /没有待应用事务/)
})
