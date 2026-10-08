import { evaluateSfa as evaluateSfaModule } from './sfaModules.ts'
import * as internal from '../../packages/framework/src/internal.ts'
import * as foundation from '../../packages/framework/src/foundation.ts'
import * as ui from '../../packages/framework/src/ui.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as runtime from '../../packages/framework/src/index.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { recordingNative, mountFrame, advanceFrames } from './recordingNative.ts'

function evaluateSfa(source: string, state: object = {}) {
    return evaluateSfaModule(source, { './state': state }, '重排验收.sfa')
}

test('真实 SFA 纯值变化只更新文本 Modifier，不执行结构且保留 Layout 身份', async () => {
    const title = runtime.ref('旧值')
    const Root = evaluateSfa("<template><Text :text=\"title\" /></template><script>import { title } from \"./state\"\n</script>", { title })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const initial = native.textNodes()
    assert.equal(initial[0].text, '旧值')
    const structures = internal.getArrangeExecutionStats().structureRuns

    title.value = '新值'
    advanceFrames()
    assert.deepEqual(native.textNodes(), [{ id: initial[0].id, text: '新值' }])
    assert.equal(internal.getArrangeExecutionStats().structureRuns, structures)
    app.unmount()
})

test('用户 SFA 直接组合 Layout、Policy 与文本 Modifier，结果等同代码 FA', () => {
    const Page = evaluateSfa("<template><Layout :measurePolicy=\"BoxMeasurePolicy()\" :modifier=\"M.padding(8.dp)\"><Layout :measurePolicy=\"MinSizeMeasurePolicy\" :modifier=\"M.text('正文')\" /></Layout></template><script>import { Layout } from '@arrange/framework/foundation'\n\nimport { BoxMeasurePolicy, MinSizeMeasurePolicy, M } from '@arrange/framework/ui'\n</script>")
    const Code = internal.defineArrangable({ setup: (_props, { call }) => () => call(0, foundation.Box, { modifier: () => ui.M.padding(8, 0) }, { default: () => call(0, foundation.Text, { text: () => '正文' }) }) })
    const collect = (definition: runtime.ArrangableDefinition) => {
        const native = recordingNative()
        const app = runtime.createApp(definition)
        mountFrame(app, native.target)
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
    const Page = internal.defineArrangable({
        setup: (_props, { call }) => () => {
            if (shown.value) call(0, foundation.Text, internal.parameterInputs(internal.parameterObject(0, () => {
                reads++
                return { text: text.value }
            })))
        }
    })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    mountFrame(app, native.target)
    shown.value = false
    advanceFrames()
    const stoppedReads = reads
    text.value = '新内容'
    advanceFrames()
    assert.equal(reads, stoppedReads)
    shown.value = true
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '新内容')
    app.unmount()
})

test('真实 SFA keyed 列表移动刷新索引并保留各项 Layout 身份', async () => {
    const items = runtime.ref([{ id: 'A' }, { id: 'B' }])
    const Root = evaluateSfa("<template><Column><Text a-for=\"(item, index) in items\" :key=\"item.id\" :text=\"item.id + index\" /></Column></template><script>import { items } from \"./state\"\n</script>", { items })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const initial = native.textNodes()
    assert.deepEqual(initial.map(node => node.text), ['A0', 'B1'])

    items.value = [items.value[1], items.value[0]]
    advanceFrames()
    assert.deepEqual(native.textNodes(), [{ id: initial[1].id, text: 'B0' }, { id: initial[0].id, text: 'A1' }])
    app.unmount()
})

test('真实 SFA 中间条件与单条目条件独立重启，根及无关兄弟保持不执行', async () => {
    const rows = runtime.ref([{ id: '甲', shown: true, title: '甲内容' }, { id: '乙', shown: true, title: '乙内容' }])
    const middleShown = runtime.ref(true)
    let rootRuns = 0
    let listRuns = 0
    const conditionRuns = new Map<string, number>()
    const rootKey = () => {
        rootRuns++
        return '根位置'
    }
    const readRows = () => {
        listRuns++
        return rows.value
    }
    const visible = (row: typeof rows.value[number]) => {
        conditionRuns.set(row.id, (conditionRuns.get(row.id) ?? 0) + 1)
        return row.shown
    }
    const Page = evaluateSfa("<template><Text :key=\"rootKey()\" text=\"固定\"/><Spacer a-if=\"middleShown\"/><Template a-for=\"row in readRows()\" :key=\"row.id\"><Text a-if=\"visible(row)\" :text=\"row.title\"/></Template></template><script>import { rootKey, readRows, visible, middleShown } from \"./state\"\n</script>", { rootKey, readRows, visible, middleShown })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    mountFrame(app, native.target)
    const before = internal.getArrangeExecutionStats()
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 1, 1])

    middleShown.value = false
    advanceFrames()
    assert.equal(internal.getArrangeExecutionStats().structureRuns - before.structureRuns, 1)
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 1, 1])

    rows.value[0].shown = false
    advanceFrames()
    assert.equal(internal.getArrangeExecutionStats().structureRuns - before.structureRuns, 2)
    assert.deepEqual([rootRuns, listRuns, ...conditionRuns.values()], [1, 1, 2, 1])
    rows.value[1].title = '乙更新'
    advanceFrames()
    assert.equal(internal.getArrangeExecutionStats().structureRuns - before.structureRuns, 2)
    assert.deepEqual(native.textNodes().map(node => node.text), ['固定', '乙更新'])
    app.unmount()
})

test('真实 SFA 空分支、多根与重复内容调用维护插入顺序及独立身份', async () => {
    const show = runtime.ref(false)
    const Content = evaluateSfa('<template><Slot/><Slot/></template>')
    const Root = evaluateSfa("<template><Text text=\"前\"/><Template a-if=\"show\"><Text text=\"中一\"/><Text text=\"中二\"/></Template><Content><Text text=\"内容\"/></Content><Text text=\"后\"/></template><script>import { show, Content } from \"./state\"\n</script>", { show, Content })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const initial = native.textNodes()
    assert.deepEqual(initial.map(node => node.text), ['前', '内容', '内容', '后'])
    assert.notEqual(initial[1].id, initial[2].id)

    show.value = true
    advanceFrames()
    const next = native.textNodes()
    assert.deepEqual(next.map(node => node.text), ['前', '中一', '中二', '内容', '内容', '后'])
    assert.deepEqual(next.filter(node => node.text === '内容'), initial.filter(node => node.text === '内容'))
    app.unmount()
})


test('对象绑定区分形状和值，字段变化不唤醒结构，移除字段恢复声明默认值', async () => {
    const values = runtime.ref<Record<string, unknown>>({ text: '正文', style: { color: 1 } })
    const Root = evaluateSfa("<template><Text a-bind=\"inputs\" /></template><script>import { computed } from '@arrange/framework'\nimport type { TextStyleProp } from '@arrange/framework/ui'\nimport { values } from \"./state\"\nconst inputs = computed(() => values.value as { text?: string; style?: TextStyleProp })\n</script>", { values })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const runs = internal.getArrangeExecutionStats().structureRuns

    values.value = { text: '更新', style: { color: 2 } }
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '更新')
    assert.equal(internal.getArrangeExecutionStats().structureRuns, runs)

    values.value = { style: { color: 3 } }
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '')
    app.unmount()
})

test('真实 SFA 动态参数改名恢复旧字段默认值，拒绝重复、非法名称和错误类型后仍可恢复', () => {
    const name = runtime.ref<unknown>('first-value')
    const value = runtime.ref<unknown>('首值')
    let setups = 0
    const Receiver = internal.defineArrangable({
        props: { firstValue: { type: String, default: '第一默认' }, secondValue: { type: String, default: '第二默认' }, fixedValue: String },
        setup(props, { call }) {
            setups++
            return () => call(0, foundation.Text, { text: () => `${props.firstValue}/${props.secondValue}/${props.fixedValue}` })
        }
    })
    const Page = evaluateSfa('<template><Receiver :[name].camel="value" fixed-value="固定" /></template><script>import { Receiver, name, value } from "./state"</script>', { Receiver, name, value })
    const native = recordingNative(), errors: unknown[] = []
    const app = runtime.createApp(Page)
    app.config.errorHandler = error => errors.push(error)
    mountFrame(app, native.target)
    const id = native.textNodes()[0].id
    assert.deepEqual(native.textNodes(), [{ id, text: '首值/第二默认/固定' }])

    name.value = 'second-value'
    value.value = '次值'
    native.frame()
    const published = [{ id, text: '第一默认/次值/固定' }]
    assert.deepEqual(native.textNodes(), published)
    const submissions = native.submissions
    for (const [invalid, diagnostic] of [['unknown', /未声明参数/], ['fixed-value', /重复参数/], ['', /非空字符串/], [null, /非空字符串/], [123, /非空字符串/]] as const) {
        const count = errors.length
        name.value = invalid
        native.frame()
        assert.equal(errors.length, count + 1)
        assert.ok(errors.at(-1) instanceof Error)
        assert.match((errors.at(-1) as Error).message, diagnostic)
        assert.deepEqual(native.textNodes(), published)
        assert.equal(native.submissions, submissions)
    }

    name.value = 'first-value'
    value.value = 123
    native.frame()
    assert.match((errors.at(-1) as Error).message, /firstValue 类型错误/)
    assert.deepEqual(native.textNodes(), published)
    assert.equal(native.submissions, submissions)
    value.value = '最终值'
    native.frame()
    assert.deepEqual(native.textNodes(), [{ id, text: '最终值/第二默认/固定' }])
    assert.equal(setups, 1)
    app.unmount()
})

test('真实 SFA 的 a-slot:header 与 #header 交付相同具名多根内容及默认内容', () => {
    const Receiver = evaluateSfa('<template><Slot name="header" /><Slot /></template>')
    const results: string[][][] = []
    for (const attribute of ['a-slot:header', '#header']) {
        const title = runtime.ref('标题')
        const Page = evaluateSfa(`<template><Receiver><Template ${attribute}><Text :text="title" /><Text text="副标题" /></Template><Text text="正文" /></Receiver></template><script>import { Receiver, title } from "./state"</script>`, { Receiver, title })
        const native = recordingNative(), app = runtime.createApp(Page)
        mountFrame(app, native.target)
        const initial = native.textNodes()
        assert.deepEqual(initial.map(node => node.text), ['标题', '副标题', '正文'])
        title.value = '更新标题'
        native.frame()
        const updated = native.textNodes()
        assert.deepEqual(updated.map(node => node.id), initial.map(node => node.id))
        assert.deepEqual(updated.map(node => node.text), ['更新标题', '副标题', '正文'])
        results.push([initial.map(node => node.text), updated.map(node => node.text)])
        app.unmount()
    }
    assert.deepEqual(results[0], results[1])
})


test('固定 Modifier 链只重新求值失效分段并精确写入既有实例', async () => {
    const width = runtime.ref(20)
    const color = runtime.ref(1)
    let widths = 0
    let colors = 0
    const readWidth = () => {
        widths++
        return width.value
    }
    const readColor = () => {
        colors++
        return color.value
    }
    const Root = evaluateSfa("<template><Box :modifier=\"M.width(readWidth().dp).background(Color(readColor()))\" /></template><script>import { M, Color } from '@arrange/framework/ui'\n\nimport { readWidth, readColor } from \"./state\"\n</script>", { readWidth, readColor })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const chains = ui.modifierStats.chainWrites
    const instances = ui.modifierStats.instanceWrites
    assert.equal(widths, 1)
    assert.equal(colors, 1)

    color.value = 2
    advanceFrames()
    assert.equal(widths, 1)
    assert.equal(colors, 2)
    assert.equal(ui.modifierStats.chainWrites, chains)
    assert.equal(ui.modifierStats.instanceWrites, instances + 1)
    app.unmount()
})

test('固定 Modifier 链相较完整表达式减少求值及分配，保持相同原生输入', async () => {
    const run = async (expression: string) => {
        const color = runtime.ref(1)
        let widths = 0
        const readWidth = () => {
            widths++
            return 20
        }
        const makeModifier = () => ui.M.width(readWidth(), 0).height(30, 0).padding(4, 0).background(color.value)
        const Page = evaluateSfa(`<template><Spacer :modifier="${expression}"/></template><script>import { M, Color } from '@arrange/framework/ui'
 import { color, readWidth, makeModifier } from "./state"
</script>`, { color, readWidth, makeModifier })
        const native = recordingNative()
        const app = runtime.createApp(Page)
        mountFrame(app, native.target)
        const initialAllocations = { ...ui.modifierAllocationStats }
        const initialExecutions = internal.getArrangeExecutionStats()
        const initialWidths = widths
        for (let index = 2; index <= 21; index++) {
            color.value = index
            advanceFrames()
        }
        const result = {
            chains: ui.modifierAllocationStats.chains - initialAllocations.chains,
            elementReferences: ui.modifierAllocationStats.elementReferences - initialAllocations.elementReferences,
            widths: widths - initialWidths,
            structures: internal.getArrangeExecutionStats().structureRuns - initialExecutions.structureRuns,
        }
        const modifier = native.nodes.get(native.nodes.get(1)!.children[0])!.inputs.get('modifier') as ui.Modifier
        app.unmount()
        return { result, modifier }
    }
    const fixed = await run('M.width(readWidth().dp).height(30.dp).padding(4.dp).background(Color(color))')
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
    const readWidth = (value: number) => {
        widths++
        return value
    }
    const Page = evaluateSfa("<template><Spacer a-for=\"row in rows\" :key=\"row.id\" :modifier=\"M.width(readWidth(row.width).dp).background(Color(color))\" /></template><script>import { M, Color } from '@arrange/framework/ui'\n import { rows, color, readWidth } from \"./state\"\n</script>", { rows, color, readWidth })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    mountFrame(app, native.target)
    assert.equal(widths, 2)
    color.value = 2
    advanceFrames()
    assert.equal(widths, 2)
    rows.value = [{ id: '乙', width: 40 }, { id: '甲', width: 50 }]
    advanceFrames()
    const children = native.nodes.get(1)!.children
    assert.deepEqual(children.map(id => (native.nodes.get(id)!.inputs.get('modifier') as ui.Modifier).elements[0].value.value), [40, 50])
    app.unmount()
})


test('KeepAlive 保留调用生命，停用释放原生受体，恢复交付最新输入', async () => {
    const selected = runtime.ref('A')
    const value = runtime.ref('初始')
    let setups = 0
    let disposals = 0
    const Child = internal.defineArrangable({
        setup(_props, { call }) {
            setups++
            runtime.onScopeDispose(() => disposals++)
            return () => call(0, foundation.Text, { text: () => value.value })
        }
    })
    const Root = evaluateSfa("<template><KeepAlive :cacheKey=\"selected\"><Child a-if=\"selected === 'A'\"/></KeepAlive></template><script>import { KeepAlive } from '@arrange/framework/foundation'\n import { selected, Child } from \"./state\"\n</script>", { selected, Child })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    const oldId = native.textNodes()[0].id

    selected.value = '空'
    advanceFrames()
    assert.deepEqual(native.textNodes(), [])
    assert.equal(disposals, 0)
    value.value = '停用后更新'
    advanceFrames()
    assert.deepEqual(native.textNodes(), [])

    selected.value = 'A'
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '停用后更新')
    assert.notEqual(native.textNodes()[0].id, oldId)
    assert.equal(setups, 1)
    app.unmount()
    assert.equal(disposals, 1)
})


test('KeepAlive 多根内容按 LRU 淘汰，隐藏项与活动项卸载均只释放一次', async () => {
    const selected = runtime.ref('A')
    const events: string[] = []
    const Child = internal.defineArrangable({
        setup(_props, { call }) {
            const identity = selected.value
            events.push(`创建 ${identity}`)
            runtime.onScopeDispose(() => events.push(`释放 ${identity}`))
            return () => {
                call(0, foundation.Text, { text: () => `${identity} 一` })
                call(1, foundation.Text, { text: () => `${identity} 二` })
            }
        }
    })
    const Root = evaluateSfa("<template><KeepAlive :cacheKey=\"selected\" :max=\"2\"><Child /></KeepAlive></template><script>import { KeepAlive } from '@arrange/framework/foundation'\n import { selected, Child } from \"./state\"\n</script>", { selected, Child })
    const native = recordingNative()
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)

    for (const key of ['B', 'A', 'C', 'B']) {
        selected.value = key
        advanceFrames()
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
    const Child = internal.defineArrangable({
        setup(_props, { call }) {
            const identity = selected.value
            events.push(`创建 ${identity}`)
            runtime.onActivated(() => events.push(`恢复 ${identity}`))
            runtime.onDeactivated(() => events.push(`停用 ${identity}`))
            return () => call(0, foundation.Text, { text: () => `${identity} ${value.value}` })
        }
    })
    const Root = evaluateSfa("<template><KeepAlive :cacheKey=\"selected\"><Child /></KeepAlive></template><script>import { KeepAlive } from '@arrange/framework/foundation'\n import { selected, Child } from \"./state\"\n</script>", { selected, Child })
    const native = recordingNative(false)
    const app = runtime.createApp(Root)
    app.config.errorHandler = error => errors.push(error)
    mountFrame(app, native.target)
    native.finish()
    selected.value = 'B'
    advanceFrames()
    native.finish()
    const before = native.textNodes()

    selected.value = 'A'
    value.value = '最新'
    advanceFrames()
    assert.deepEqual(native.textNodes(), before)
    native.finish('拒绝恢复')
    assert.deepEqual(native.textNodes(), before)
    assert.deepEqual(events, ['创建 A', '创建 B', '停用 A'])
    assert.equal(errors.length, 1)

    selected.value = 'B'
    advanceFrames()
    native.finish()
    selected.value = 'A'
    advanceFrames()
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['A 最新'])
    assert.deepEqual(events, ['创建 A', '创建 B', '停用 A', '停用 B', '恢复 A'])
    app.unmount()
})

test('卸载尚未应用的候选会取消原生提交并释放候选资源', () => {
    let disposed = 0
    const Root = internal.defineArrangable({
        setup(_props, { call }) {
            runtime.onScopeDispose(() => disposed++)
            return () => call(0, foundation.Text, { text: () => '候选' })
        }
    })
    const native = recordingNative(false)
    const app = runtime.createApp(Root)
    mountFrame(app, native.target)
    app.unmount()
    assert.equal(disposed, 1)
    assert.deepEqual(native.textNodes(), [])
    assert.throws(() => native.finish(), /没有待应用事务/)
})

test('Color.hsl 在 SFA 模板颜色绑定中转换为 ARGB 并响应动画值', () => {
    const hue = runtime.ref(0)
    const source = `<template><Text text="彩虹" :style="{ color: Color.hsl(hue, 1, 0.5) }" /></template><script>
import { Color } from '@arrange/framework/ui'
import { hue } from "./state"
</script>`
    const compiled = compileArrangeSfa(source, '颜色.sfa')
    assert.doesNotMatch(compiled.code, /Color\.hsl\s*\(/)
    assert.match(compiled.code, /Math\.round\([^)]*255\)/)
    assert.match(compiled.code, />>> 0/)
    assert.match(compiled.code, /Number\.isFinite\(__arrangeColorHue\)/)
    const Page = evaluateSfa(source, { hue })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    mountFrame(app, native.target)
    assert.equal(native.textNodes()[0].text, '彩虹')
    hue.value = 120
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '彩虹')
    app.unmount()
})

test('Color 的 ARGB 数值与通道对象在 SFA 中直接生成裸数字表达式', () => {
    const staticSource = `<template><Text :style="{ color: Color({ red: 1, green: 0.5, blue: 0, alpha: 0.25 }) }" /></template><script>
import { Color } from '@arrange/framework/ui'
</script>`
    const staticCode = compileArrangeSfa(staticSource, '颜色静态.sfa').code
    assert.doesNotMatch(staticCode, /from ['"]@arrange\/framework\/ui['"]/)
    assert.match(staticCode, /1090486272/)

    const dynamicSource = `<template><Text :style="{ color: Color({ red, green: 0.5, blue, alpha }) }" /></template><script>
import { Color } from '@arrange/framework/ui'
import { red, blue, alpha } from './state'
</script>`
    const dynamicCode = compileArrangeSfa(dynamicSource, '颜色动态.sfa').code
    assert.doesNotMatch(dynamicCode, /Color\s*\(/)
    assert.match(dynamicCode, /const __arrangeColorInput0 = \(_unref\(red\)\)/)
    assert.match(dynamicCode, /const __arrangeColorInput1 = \(_unref\(blue\)\)/)
    assert.match(dynamicCode, /Number\.isFinite\(__arrangeColorRedValue\)/)
    assert.match(dynamicCode, /const __arrangeColorInput2 = \(_unref\(alpha\)\)/)
    assert.match(dynamicCode, /\(__arrangeColorInput2\) \?\? 1/)
})

test('Color 可在 SFA 中同时作为类型和值使用而无需别名', () => {
    const source = `<template><Text :style="{ color: Color(0xff123456) }" /></template><script>
import { M, Color, type Dp } from '@arrange/framework/ui'
const props = defineProps<{ color: Color; offset: Dp }>()
</script>`
    const code = compileArrangeSfa(source, '颜色同名类型和值.sfa').code
    assert.match(code, /color: \{ type: Number as _PropType<\(\{ color: number; offset: number \}\)\["color"\]>, required: true \}/)
    assert.match(code, /offset: \{ type: Number as _PropType<\(\{ color: number; offset: number \}\)\["offset"\]>, required: true \}/)
    assert.match(code, /color: 4279383126/)
    assert.match(code, /import \{ M, type Dp \} from ['"]@arrange\/framework\/ui['"]/)
    assert.doesNotMatch(code, /\bColor\b/)
})

test('Color 动态通道对象只求值一次并拆成 ARGB 数字', () => {
    const source = `<template><Text :style="{ color: Color(channels) }" /></template><script>
import { Color } from '@arrange/framework/ui'
const channels: { red: number; green: number; blue: number; alpha?: number } = getChannels()
</script>`
    const code = compileArrangeSfa(source, '颜色动态对象.sfa').code
    assert.match(code, /const __arrangeColorChannels = \(\(_unref\(channels\)\)\)/)
    assert.match(code, /__arrangeColorChannels\.red/)
    assert.doesNotMatch(code, /color: \(channels\)/)
})

test('Color 未知类型输入也不会把通道对象直送 native', () => {
    const source = `<template><Text :style="{ color: Color(channels) }" /></template><script>
import { Color } from '@arrange/framework/ui'
import { channels } from './state'
</script>`
    const code = compileArrangeSfa(source, '颜色未知对象.sfa').code
    assert.match(code, /typeof __arrangeColorValue === 'number'/)
    assert.match(code, /__arrangeColorValue\.red/)
    assert.doesNotMatch(code, /color: \(_unref\(channels\)\)/)
})

test('Color 静态十六进制值参与 ARGB 与通道范围校验', () => {
    assert.throws(() => compileArrangeSfa(`<template><Text :style="{ color: Color({ red: 0xff, green: 0, blue: 0 }) }" /></template><script>import { Color } from '@arrange/framework/ui'</script>`, '颜色通道越界.sfa'), /red 通道必须在 0\.\.1/)
    assert.throws(() => compileArrangeSfa(`<template><Text :style="{ color: Color(0x100000000) }" /></template><script>import { Color } from '@arrange/framework/ui'</script>`, '颜色数值越界.sfa'), /ARGB 数值必须是 uint32/)
})

test('Color 动态 ARGB 保留 uint32 校验并在失败后保留已发布颜色', () => {
    const color = runtime.ref(0xff123456)
    const source = `<template><Text text="颜色" :style="{ color: Color(color) }" /></template><script>
import { Color } from '@arrange/framework/ui'
import { color } from './state'
</script>`
    const Page = evaluateSfa(source, { color })
    const native = recordingNative(), errors: unknown[] = []
    const app = runtime.createApp(Page)
    app.config.errorHandler = error => errors.push(error)
    mountFrame(app, native.target)
    const input = native.nodes.get(native.textNodes()[0].id)!
    const published = input.inputs.get('modifier')
    const writes = native.writes
    for (const invalid of [-1, 0x100000000, 1.5, NaN, Infinity]) {
        color.value = invalid
        native.frame()
        assert.equal(native.nodes.get(input.id)!.inputs.get('modifier'), published)
        assert.equal(native.writes, writes)
    }
    assert.equal(errors.length, 5)
    assert.ok(errors.every(error => error instanceof Error && /ARGB/.test(error.message)))
    color.value = 0
    native.frame()
    const modifier = native.nodes.get(input.id)!.inputs.get('modifier') as ui.Modifier
    const text = modifier.elements.find(element => element.type === 'text')!
    assert.equal((text.value.style as { color: number }).color, 0)
    app.unmount()
})

test('const 通道对象仍可变，Color 不把初始化字段永久折叠成旧颜色', () => {
    const source = `<template><Text text="可变颜色" :style="{ color: Color(channels) }" /></template><script>
import { Color } from '@arrange/framework/ui'
const channels = { red: 1, green: 0, blue: 0 }
channels.red = 0
channels.green = 1
</script>`
    const native = recordingNative(), app = runtime.createApp(evaluateSfa(source))
    mountFrame(app, native.target)
    const node = native.nodes.get(native.textNodes()[0].id)!
    const modifier = node.inputs.get('modifier') as ui.Modifier
    const text = modifier.elements.find(element => element.type === 'text')!
    assert.equal((text.value.style as { color: number }).color, 0xff00ff00)
    app.unmount()
})

test('Color 拆箱按对象字面量顺序求值，显式 void alpha 的副作用保留', () => {
    const trace: string[] = []
    const readChannel = (name: string, value: number) => {
        trace.push(name)
        return value
    }
    const source = `<template><Text text="求值顺序" :style="{ color }" /></template><script>
import { Color } from '@arrange/framework/ui'
import { readChannel } from './state'
const color = Color({ red: readChannel('red', 1), green: readChannel('green', 0), blue: readChannel('blue', 0), alpha: void readChannel('alpha', 1) })
</script>`
    const native = recordingNative(), app = runtime.createApp(evaluateSfa(source, { readChannel }))
    mountFrame(app, native.target)
    assert.deepEqual(trace, ['red', 'green', 'blue', 'alpha'])
    const modifier = native.nodes.get(native.textNodes()[0].id)!.inputs.get('modifier') as ui.Modifier
    const text = modifier.elements.find(element => element.type === 'text')!
    assert.equal((text.value.style as { color: number }).color, 0xffff0000)
    app.unmount()
})

test('Color 不把被遮蔽的 Object.freeze 当作纯静态对象构造', () => {
    const source = `<template><Text text="对象调用" :style="{ color }" /></template><script>
import { Color } from '@arrange/framework/ui'
const Object = { freeze(value: { red: number; green: number; blue: number }) { if ('red' in value) { value.red = 0; value.green = 1 } return value } }
const color = Color(Object.freeze({ red: 1, green: 0, blue: 0 }))
</script>`
    const native = recordingNative(), app = runtime.createApp(evaluateSfa(source))
    mountFrame(app, native.target)
    const modifier = native.nodes.get(native.textNodes()[0].id)!.inputs.get('modifier') as ui.Modifier
    const text = modifier.elements.find(element => element.type === 'text')!
    assert.equal((text.value.style as { color: number }).color, 0xff00ff00)
    app.unmount()
})

test('真实 SFA 的 AnimatedVisibility 保留退出和反向期间 Input 编辑值，完全退出后重新初始化', () => {
    const visible = runtime.ref(true)
    const source = `<template><AnimatedVisibility :visible="visible" :animationSpec="spec"><Input value="初始编辑值" /></AnimatedVisibility></template><script>
import { AnimatedVisibility, tween, linearEasing } from '@arrange/framework/animation'
import { visible } from './state'
const spec = tween({ durationMillis: 100, easing: linearEasing })
</script>`
    const native = recordingNative(), app = runtime.createApp(evaluateSfa(source, { visible }))
    mountFrame(app, native.target)
    const inputId = native.textNodes()[0].id
    const node = native.nodes.get(inputId)!
    const modifier = node.inputs.get('modifier') as ui.Modifier
    const textField = modifier.elements.find(element => element.type === 'textField')!
    const handles = node.modifiers
    const edited = textField.value.onValueChange as (value: string) => void
    edited('已经编辑')
    native.frame()
    assert.deepEqual(native.textNodes(), [{ id: inputId, text: '已经编辑' }])
    visible.value = false
    native.frame()
    assert.deepEqual(native.textNodes(), [{ id: inputId, text: '已经编辑' }])
    native.frame(native.time + 40)
    visible.value = true
    native.frame()
    native.frame(native.time + 100)
    assert.deepEqual(native.textNodes(), [{ id: inputId, text: '已经编辑' }])
    assert.deepEqual(native.nodes.get(inputId)!.modifiers, handles)
    visible.value = false
    native.frame()
    native.frame(native.time + 100)
    native.frame()
    assert.equal(native.textNodes().length, 0)
    visible.value = true
    native.frame()
    assert.equal(native.textNodes()[0].text, '初始编辑值')
    assert.notEqual(native.textNodes()[0].id, inputId)
    app.unmount()
})

test('Color 的 namespace 与别名导入在消融后退出生成 TS', () => {
    const namespaceCode = compileArrangeSfa(`<template><Text :style="{ color: Ui.Color(0xff123456) }" /></template><script>import * as Ui from '@arrange/framework/ui'</script>`, '颜色命名空间.sfa').code
    assert.doesNotMatch(namespaceCode, /from ['"]@arrange\/framework\/ui['"]/)

    const elementCode = compileArrangeSfa(`<template><Text :style="{ color: Ui['Color'](0xff123456) }" /></template><script>import * as Ui from '@arrange/framework/ui'</script>`, '颜色元素访问.sfa').code
    assert.doesNotMatch(elementCode, /Ui\[['"]Color['"]\]/)
    assert.doesNotMatch(elementCode, /from ['"]@arrange\/framework\/ui['"]/)

    const aliasCode = compileArrangeSfa(`<template><Text :style="{ color: C(0xff123456) }" /></template><script>import { Color as C } from '@arrange/framework/ui'</script>`, '颜色别名.sfa').code
    assert.doesNotMatch(aliasCode, /from ['"]@arrange\/framework\/ui['"]/)

    const destructuredCode = compileArrangeSfa(`<template><Text :style="{ color: C(0xff123456) }" /></template><script>import * as Ui from '@arrange/framework/ui'
const { Color: C } = Ui</script>`, '颜色解构.sfa').code
    assert.doesNotMatch(destructuredCode, /const \{ Color: C \} = Ui/)
    assert.doesNotMatch(destructuredCode, /from ['"]@arrange\/framework\/ui['"]/)
    assert.throws(() => compileArrangeSfa(`<template><Text text="x" /></template><script>import { Color } from '@arrange/framework/ui'
const factory = Color</script>`, '颜色工厂引用.sfa'), /Color 只能作为 SFA 编译期构造调用使用/)
})

test('Color 的嵌套解构可消融并拒绝循环变量解构', () => {
    const nested = compileArrangeSfa(`<template><Text text="x" /></template><script>import * as Ui from '@arrange/framework/ui'
function make() { const { Color } = Ui; return Color(0xff123456) }</script>`, '颜色嵌套解构.sfa').code
    assert.match(nested, /4279383126/)
    assert.doesNotMatch(nested, /const \{ Color \} = Ui/)
    assert.doesNotMatch(nested, /from ['"]@arrange\/framework\/ui['"]/)

    assert.throws(() => compileArrangeSfa(`<template><Text text="x" /></template><script>import * as Ui from '@arrange/framework/ui'
function make() { for (const { Color } of [Ui]) return Color(0xff123456) }</script>`, '颜色循环解构.sfa'), /Color 解构只能出现在变量声明语句中/)

    const computed = compileArrangeSfa(`<template><Text text="x" /></template><script>import * as Ui from '@arrange/framework/ui'
const { ['Color']: C } = Ui
const color = C(0xff123456)</script>`, '颜色计算解构.sfa').code
    assert.match(computed, /const color = 4279383126/)
    assert.doesNotMatch(computed, /const \{ \['Color'\]: C \} = Ui/)
})
