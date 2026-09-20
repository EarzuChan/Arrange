import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { checkSfaProject } from '../../packages/vite-plugin/src/typecheck.ts'
import { compile } from '../../packages/arrange-vue-compiler-arrange/src/index.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import * as runtime from '../../packages/runtime/src/index.ts'

function evaluateSfa(source: string, imports: Record<string, unknown> = {}) {
    const { code } = compileArrangeSfa(source, '契约.sfa')
    const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { default?: runtime.Arrangable } = {}
    new Function('require', 'exports', output)((name: string) => imports[name] ?? runtime, exports)
    return exports.default!
}

test('模板内容和指令只接受正式语法，空白不改变结构', () => {
    for (const source of ['<Row>正文</Row>', '<Text>{{ title }}</Text>', '<Xxx :value />', '<Xxx @submit="go" />', '<Input v-model="value" />', '<Box ref="box" />', '<Box v-pre />', '<Box v-once />', '<Box v-memo="[]" />', '<keep-alive />', '<Xxx :someValue="a" :some-value="b" />']) assert.throws(() => compile(source), SyntaxError)
    const options = { mode: 'module' as const, prefixIdentifiers: true }
    assert.equal(compile('<Row><Spacer/> <Spacer/></Row>', options).code, compile('<Row>\n    <Spacer/>\n    <Spacer/>\n</Row>', options).code)
    assert.match(compile('<Xxx enabled />', options).code, /enabled: true/)
    assert.match(compile('<Xxx enabled="" />', options).code, /enabled: ""/)
})

test('SFA 只接受无属性的 TS setup，原样 Ref 与普通绑定明确分开', () => {
    for (const attributes of ['setup', 'lang="ts"', 'lang="js"']) assert.throws(() => compileArrangeSfa(`<script ${attributes}>const x = 1</script>`, '失败.sfa'), /不接受属性/)
    assert.throws(() => compileArrangeSfa('<script>const a = 1</script><script>const b = 2</script>', '失败.sfa'))
    const result = compileArrangeSfa('<template><Editor :raw="<state>" :plain="state" /></template><script>import { ref } from "@arrange/framework"; const state = ref(1)</script>', '状态.sfa')
    assert.match(result.code, /return state\n/)
    assert.match(result.code, /return state.value/)
    const definition = evaluateSfa('<script>import type { Ref } from "@arrange/framework"; defineProps<{ state: Ref<number>; count: number; enabled?: boolean }>()</script>')
    assert.deepEqual((definition as { props: unknown }).props, { state: { type: Object, required: true, refKind: 'writable' }, count: { type: Number, required: true }, enabled: { type: Boolean, required: false } })
})

test('参数对象按同一 camelize 规则拒绝重复，不合并回调', () => {
    assert.throws(() => runtime.mergeProps({ someValue: 1 }, { 'some-value': 2 }), /重复参数/)
    assert.throws(() => runtime.mergeProps({ onSubmit() {} }, { onSubmit() {} }), /重复参数/)
    assert.throws(() => runtime.arrangeParameterName(undefined), /非空字符串/)
    assert.deepEqual({ ...runtime.mergeProps({ 'some-value': 1 }) }, { someValue: 1 })
})

test('真实 SFA 命令行类型检查保留脚本和跨文件参数契约', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-typecheck-'))
    try {
        writeFileSync(join(directory, 'Editor.sfa'), '<template><Text :text="String(state.value)" /></template><script>import type { Ref } from "@arrange/framework"\ndefineProps<{ state: Ref<number>; flag?: boolean }>()</script>')
        writeFileSync(join(directory, 'Good.sfa'), '<template><Editor :state="<state>" /></template><script>import { ref } from "@arrange/framework"\nimport Editor from "./Editor.sfa"\nconst state = ref(1)</script>')
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Good.sfa')]), [])

        writeFileSync(join(directory, 'Bad.sfa'), '<template>\n    <Editor :state="state" flag="false" />\n    <Text :text="({ a: 1 })" />\n</template>\n<script>\nimport { ref } from "@arrange/framework"\nimport Editor from "./Editor.sfa"\nconst state = ref(1)\nconst broken: number = "错误"\n</script>')
        const diagnostics = checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Bad.sfa')])
        assert.ok(diagnostics.some(item => item.line === 2 && /Ref/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => item.line === 2 && /boolean/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => item.line === 3 && /string/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => item.line === 9), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})

function recordingNative() {
    const nodes = new Map<number, { type: string; inputs: Map<string, unknown> }>()
    const bindings = new Map<bigint, { id: number; input: string }>()
    let identity = 1n
    const target: runtime.NativeTransactionTarget = {
        createNode(id, type) { nodes.set(id, { type, inputs: new Map() }) },
        deleteNode(id) { nodes.delete(id) },
        insertChild() {},
        removeChild() {},
        unmount() { nodes.clear(); bindings.clear() },
        registerBinding(id, input) {
            const handle = { identity: identity++, generation: 1n }
            bindings.set(handle.identity, { id, input })
            return handle
        },
        updateBinding(handle, value) {
            const binding = bindings.get(handle.identity)!
            nodes.get(binding.id)!.inputs.set(binding.input, value)
        },
        releaseBinding(handle) { bindings.delete(handle.identity) },
    }
    return { nodes, target }
}

test('内建 Arrangable 各自声明参数，不给 Spacer 和文本补充通用输入', () => {
    for (const [definition, props] of [[runtime.Spacer, { enabled: true }], [runtime.Text, { contentDescription: '误传' }], [runtime.Row, { role: '误传' }]] as const) {
        assert.throws(() => runtime.createApp({ setup: () => () => runtime.h(definition, props) }).mount(recordingNative().target), /未声明参数/)
    }
})





test('手写结构也不能通过裸值或文本子内容绕过 Text 参数', () => {
    assert.throws(() => runtime.createVNode('Text', null, '正文'), /不能通过字符串/)
    assert.throws(() => runtime.createVNode('Box', null, { default: () => '正文' }), /不能通过字符串/)
    assert.throws(() => runtime.createApp({ setup: () => () => '正文' }).mount(recordingNative().target), /text 参数/)
})

test('SFA Slot 声明约束内容名称，多次调用拥有独立实例和结构订阅', async () => {
    const Consumer = evaluateSfa('<template><Slot /><Slot /></template>')
    const visible = runtime.ref(true)
    const label = runtime.ref('初始文字')
    let created = 0
    let disposed = 0
    let parentRuns = 0
    let contentRuns = 0
    const Probe = runtime.defineArrangable({
        setup() {
            const identity = ++created
            runtime.onUnmounted(() => { disposed++ })
            return () => runtime.h(runtime.Text, { text: runtime.arrangeValue(() => `${identity}：${label.value}`) })
        },
    })
    const native = recordingNative()
    const app = runtime.createApp({
        setup: () => () => {
            parentRuns++
            return runtime.h(Consumer, null, { default: () => {
                contentRuns++
                return visible.value ? [runtime.h(Probe)] : []
            } })
        },
    })
    app.mount(native.target)
    assert.equal(created, 2)
    assert.equal(parentRuns, 1)
    assert.equal(contentRuns, 2)
    assert.equal([...native.nodes.values()].filter(node => node.inputs.get('textPresentation') === 'display').length, 2)

    label.value = '更新文字'
    await runtime.nextTick()
    assert.equal(contentRuns, 2)
    assert.equal(parentRuns, 1)
    assert.deepEqual([...native.nodes.values()].filter(node => node.inputs.get('textPresentation') === 'display').map(node => node.inputs.get('text')), ['1：更新文字', '2：更新文字'])

    visible.value = false
    await runtime.nextTick()
    assert.equal(contentRuns, 4)
    assert.equal(parentRuns, 1)
    assert.equal(disposed, 2)
    assert.equal([...native.nodes.values()].filter(node => node.inputs.get('textPresentation') === 'display').length, 0)

    app.unmount()
    visible.value = true
    label.value = '卸载后的更新'
    await runtime.nextTick()
    assert.equal(contentRuns, 4)
    assert.equal(created, 2)

    assert.throws(() => runtime.createApp({ setup: () => () => runtime.h(Consumer, null, { header: () => [] }) }).mount(recordingNative().target), /未声明内容入口：header/)
    const Empty = evaluateSfa('<template></template>')
    assert.throws(() => runtime.createApp({ setup: () => () => runtime.h(Empty, null, { default: () => [] }) }).mount(recordingNative().target), /未声明内容入口：default/)
})


test('原样 Ref 标记保留泛型、比较与类型断言的 TS 边界', () => {
    const compileBinding = (expression: string) => compileArrangeSfa('<template><Editor :state="' + expression + '" /></template><script>const state = 1; const other = 2; const factory = &lt;T,&gt;(value: T) =&gt; value</script>'.replaceAll('&lt;', '<').replaceAll('&gt;', '>'), '边界.sfa').code
    assert.match(compileBinding('<state>'), /\[state\]/)
    assert.match(compileBinding('<factory<number>(state)>'), /factory<number>\(state\)/)
    assert.match(compileBinding('<state > other ? state : other>'), /state > other/)
    assert.doesNotThrow(() => compileBinding('state < other'))
    assert.doesNotThrow(() => compileBinding('<number>factory<number>'))
    assert.throws(() => compileBinding('<>'))
    assert.throws(() => compileBinding('<state><other>'))
})

test('SFA 类型检查按 paths 解析定义并拒绝未声明具名内容', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-alias-'))
    try {
        writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { baseUrl: '.', paths: { ...Object.fromEntries(Object.entries(ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile).config.compilerOptions.paths as Record<string, string[]>).map(([name, entries]) => [name, entries.map(entry => resolve(entry))])), '@views/*': ['./*'] } } }))
        writeFileSync(join(directory, 'Receiver.sfa'), '<template><Slot name="header" /></template>')
        writeFileSync(join(directory, 'Good.sfa'), '<template><Receiver><Template #header><Text text="标题" /></Template></Receiver></template><script>import Receiver from "@views/Receiver.sfa"</script>')
        assert.deepEqual(checkSfaProject(join(directory, 'tsconfig.json'), [join(directory, 'Good.sfa')]), [])

        writeFileSync(join(directory, 'Bad.sfa'), '<template><Receiver><Template #footer><Text text="误传" /></Template></Receiver></template><script>import Receiver from "@views/Receiver.sfa"</script>')
        const diagnostics = checkSfaProject(join(directory, 'tsconfig.json'), [join(directory, 'Bad.sfa')])
        assert.ok(diagnostics.some(item => item.file.endsWith('Bad.sfa') && item.line === 1 && /never/.test(item.message)), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})


test('深层 Arrangable 挂载和退休不依赖递归调用栈，生命周期仍为子先父后', () => {
    const native = recordingNative()
    const events: string[] = []
    const depth = 1800
    let definition: runtime.Arrangable = runtime.Text
    for (let level = 0; level < depth; level++) {
        const child: runtime.Arrangable = definition
        definition = runtime.defineArrangable({ setup() {
            runtime.onMounted(() => events.push('挂载' + level))
            runtime.onUnmounted(() => events.push('卸载' + level))
            return () => runtime.h(child)
        } })
    }
    const before = runtime.getArrangeExecutionStats().activeValueBindings
    const app = runtime.createApp(definition)
    app.mount(native.target)
    assert.equal(events.length, depth)
    assert.equal(events[0], '挂载0')
    assert.equal(events[depth - 1], '挂载' + (depth - 1))
    app.unmount()
    assert.equal(events.length, depth * 2)
    assert.equal(events[depth], '卸载0')
    assert.equal(events.at(-1), '卸载' + (depth - 1))
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, before)
    assert.equal(native.nodes.size, 0)
})

test('挂载后续分支失败时取消成功通知并退休已创建的作用域', async () => {
    const events: string[] = []
    const native = recordingNative()
    const before = runtime.getArrangeExecutionStats().activeValueBindings
    const Good = runtime.defineArrangable({ setup() {
        runtime.onMounted(() => events.push('不应挂载成功'))
        runtime.onScopeDispose(() => events.push('清理'))
        return () => runtime.h(runtime.Text, { text: runtime.arrangeValue(() => '先创建的内容') })
    } })
    const app = runtime.createApp({ setup: () => () => [runtime.h(Good), runtime.h(runtime.Spacer, { unknown: 1 })] })
    assert.throws(() => app.mount(native.target), /未声明参数/)
    await runtime.nextTick()
    assert.deepEqual(events, ['清理'])
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, before)
    assert.equal(native.nodes.size, 0)
})


test('固定声明按参数位置读取，动态调用同样校验且默认值按实例求值', async () => {
    const run = async (binding: string) => {
        let defaults = 0
        const Probe = runtime.defineArrangable({
            props: { amount: { type: Number, required: true }, label: { type: String, default: () => { defaults++; return '值' } } },
            setup: props => () => runtime.h(runtime.Text, { text: runtime.arrangeValue(() => props.label + props.amount) }),
        })
        const Wrapper = evaluateSfa('<template><Probe ' + binding + ' /></template><script>defineProps<{ amount: number }>()</script>')
        const amount = runtime.ref(0)
        const native = recordingNative()
        const app = runtime.createApp({ setup: () => () => runtime.h(Wrapper, { amount: runtime.arrangeValue(() => amount.value) }) })
        app.arrangable('Probe', Probe)
        app.mount(native.target)
        const baseline = runtime.getArrangeExecutionStats()
        for (let index = 1; index <= 40; index++) {
            amount.value = index
            await runtime.nextTick()
        }
        const after = runtime.getArrangeExecutionStats()
        assert.equal(defaults, 1)
        assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '值40'))
        app.unmount()
        return { names: after.parameterNameChecks - baseline.parameterNameChecks, positions: after.parameterPositionReads - baseline.parameterPositionReads, structure: after.structureRuns - baseline.structureRuns }
    }
    const fixed = await run(':amount="amount"')
    const dynamic = await run('v-bind="{ amount }"')
    assert.equal(fixed.structure, 0)
    assert.equal(dynamic.structure, 0)
    assert.equal(fixed.positions, 80)
    assert.equal(dynamic.positions, 0)
    assert.equal(dynamic.names - fixed.names, 40)
    console.log('参数位置对比：' + JSON.stringify({ fixed, dynamic }))
})


test('真实 SFA 原样 Ref 保留身份，切换本体退订旧值，只读状态不能传给可写声明', async () => {
    const first = runtime.ref(1)
    const second = runtime.ref(10)
    const selected = runtime.ref(false)
    const observed: unknown[] = []
    const Editor = evaluateSfa('<template><Text :text="String(oriRef.value)" /></template><script>import type { Ref } from "@arrange/framework"; import { observed } from "harness"; const props = defineProps<{ oriRef: Ref<number> }>(); observed.push(props.oriRef)</script>', { harness: { observed } })
    const Page = evaluateSfa('<template><Editor v-bind:ori-ref.camel="<selected.value ? second : first>" /></template><script>import Editor from "./Editor.sfa"; import { selected, first, second } from "harness"</script>', { './Editor.sfa': { default: Editor }, harness: { selected, first, second } })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    app.mount(native.target)
    assert.equal(observed[0], first)
    const before = runtime.getArrangeExecutionStats()
    first.value = 2
    await runtime.nextTick()
    assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '2'))
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, before.structureRuns)

    selected.value = true
    await runtime.nextTick()
    assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '10'))
    const switched = runtime.getArrangeExecutionStats()
    first.value = 3
    await runtime.nextTick()
    assert.equal(runtime.getArrangeExecutionStats().valueEvaluations, switched.valueEvaluations)
    second.value = 11
    await runtime.nextTick()
    assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '11'))
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, before.structureRuns)
    app.unmount()

    assert.throws(() => runtime.createApp(Editor, { oriRef: runtime.readonly(first) }).mount(recordingNative().target), /可写.*Ref/)
    assert.throws(() => runtime.createApp(Editor, { oriRef: { value: 1 } }).mount(recordingNative().target), /Ref 本体/)
    const ReadOnlyEditor = evaluateSfa('<template><Text :text="String(oriRef.value)" /></template><script>import type { Ref } from "@arrange/framework"; defineProps<{ oriRef: Readonly<Ref<number>> }>()</script>')
    const readOnly = runtime.readonly(second)
    const readApp = runtime.createApp(ReadOnlyEditor, { oriRef: readOnly })
    readApp.mount(recordingNative().target)
    assert.ok(runtime.isReadonly(readOnly))
    readApp.unmount()
})


test('深层实际 LayoutNode 账本按任务栈创建和退休', () => {
    let definition: runtime.Arrangable = runtime.Text
    const depth = 1200
    for (let level = 0; level < depth; level++) {
        const child: runtime.Arrangable = definition
        definition = runtime.defineArrangable({ setup: () => () => runtime.h(runtime.Box, null, { default: () => [runtime.h(child)] }) })
    }
    const native = recordingNative()
    const before = runtime.getArrangeExecutionStats().activeValueBindings
    const app = runtime.createApp(definition)
    app.mount(native.target)
    assert.equal(native.nodes.size, depth + 2)
    app.unmount()
    assert.equal(native.nodes.size, 0)
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, before)
})

test('Ref 声明沿泛型别名及真实导入身份推断，不按名字猜测', () => {
    const kinds = (declarations: string, type: string) => {
        const definition = evaluateSfa('<script>import type { Ref, ComputedRef } from "@arrange/framework"; ' + declarations + '; defineProps<{ state: ' + type + ' }>()</script>')
        return (definition as { props: Record<string, { refKind?: string }> }).props.state.refKind
    }
    assert.equal(kinds('type Identity<T> = T; type State<T> = Identity<Ref<T>>', 'State<number>'), 'writable')
    assert.equal(kinds('type Identity<T> = T', 'Identity<Readonly<Ref<number>>>'), 'readonly')
    assert.equal(kinds('type State<T = Ref<number>> = T', 'State'), 'writable')
    assert.equal(kinds('', 'Ref<number> | ComputedRef<number>'), 'readonly')
    const local = evaluateSfa('<script>type Ref<T> = { value: T }; defineProps<{ state: Ref<number> }>()</script>')
    assert.equal((local as { props: Record<string, { refKind?: string }> }).props.state.refKind, undefined)
})


test('同一参数组同时改变时校验完整新值，无关表达式保留缓存', async () => {
    const lower = runtime.ref(1)
    const upper = runtime.ref(2)
    const other = runtime.ref('独立')
    let otherReads = 0
    const snapshots: string[] = []
    const Receiver = runtime.defineArrangable({
        props: { lower: { type: Number, validator: (value, props) => Number(value) < Number(props.upper) }, upper: Number, other: String },
        setup(props) {
            runtime.watch(() => [props.lower, props.upper], values => snapshots.push(values.join('/')))
            return () => runtime.h(runtime.Text, { text: runtime.arrangeValue(() => props.lower + '/' + props.upper) })
        },
    })
    const app = runtime.createApp({ setup: () => () => runtime.h(Receiver, { lower: runtime.arrangeValue(() => lower.value), upper: runtime.arrangeValue(() => upper.value), other: runtime.arrangeValue(() => { otherReads++; return other.value }) }) })
    const native = recordingNative()
    app.mount(native.target)
    lower.value = 10
    upper.value = 20
    await runtime.nextTick()
    assert.deepEqual(snapshots, ['10/20'])
    assert.equal(otherReads, 1)
    assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '10/20'))
    app.unmount()
})

test('稳定参数与内容描述跨外层重排复用，动态调用保持同一结果', async () => {
    const run = async (attributes: string) => {
        const amount = runtime.ref(1)
        const visible = runtime.ref(false)
        const Page = evaluateSfa('<template><Text ' + attributes + ' /><Box><Text text="内容" /></Box><Spacer v-if="visible" /></template><script>import { amount, visible } from "harness"</script>', { harness: { amount, visible } })
        const native = recordingNative()
        const app = runtime.createApp(Page)
        app.mount(native.target)
        const before = runtime.getArrangeExecutionStats()
        for (let index = 0; index < 12; index++) {
            visible.value = !visible.value
            await runtime.nextTick()
        }
        amount.value = 2
        await runtime.nextTick()
        assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '2'))
        const after = runtime.getArrangeExecutionStats()
        app.unmount()
        return { descriptions: after.valueDescriptions - before.valueDescriptions, fixedGroups: after.fixedParameterGroups - before.fixedParameterGroups, dynamicGroups: after.dynamicParameterGroups - before.dynamicParameterGroups, evaluations: after.valueEvaluations - before.valueEvaluations }
    }
    const fixed = await run(':text="String(amount)"')
    const dynamic = await run('v-bind="{ text: String(amount) }"')
    assert.equal(fixed.dynamicGroups, 0)
    assert.ok(dynamic.descriptions > fixed.descriptions)
    assert.ok(dynamic.dynamicGroups > 0)
    console.log('描述分配与求值对比：' + JSON.stringify({ fixed, dynamic }))
})


test('Painter 资源状态保留版本、失败、取消和所属作用域释放', () => {
    const previous = globalThis.__ARRANGE_NATIVE__
    const callbacks: ((completion: { contentVersion: number; width?: number; height?: number; error?: string }) => void)[] = []
    const retired: bigint[] = []
    globalThis.__ARRANGE_NATIVE__ = {
        ...recordingNative().target,
        acquirePainter(_location, complete) {
            callbacks.push(complete)
            return { identity: BigInt(callbacks.length), generation: 1n }
        },
        releasePainter(handle) { retired.push(handle.identity) },
    }
    try {
        const scope = runtime.effectScope()
        const image = scope.run(() => runtime.painter('图片.svg'))!
        assert.equal(image.status, 'loading')
        callbacks[0]({ contentVersion: 2, width: 24, height: 12 })
        assert.equal(image.status, 'ready')
        assert.deepEqual(image.intrinsicSize, { width: 24, height: 12 })
        callbacks[0]({ contentVersion: 1, width: 1, height: 1 })
        assert.equal(image.contentVersion, 2)
        scope.stop()
        image.dispose()
        callbacks[0]({ contentVersion: 4, width: 48, height: 48 })
        assert.equal(image.status, 'disposed')
        assert.equal(image.intrinsicSize, undefined)
        assert.deepEqual(retired, [1n])

        const failed = runtime.painter('损坏.png')
        callbacks[1]({ contentVersion: 1, error: '解码失败' })
        assert.equal(failed.status, 'failed')
        assert.equal(failed.error, '解码失败')
        assert.throws(() => runtime.M.paint(failed), /解码失败/)
        failed.dispose()
        assert.deepEqual(retired, [1n, 2n])
    } finally {
        globalThis.__ARRANGE_NATIVE__ = previous
    }
})


test('跨文件 Ref 转导出保留身份，循环转导出产生定位诊断', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-ref-exports-'))
    try {
        writeFileSync(join(directory, 'state.ts'), 'export type { Ref as State } from "@arrange/framework"')
        writeFileSync(join(directory, 'barrel.ts'), 'export type { State } from "./state"')
        const source = '<script>import type { State } from "./barrel"; defineProps<{ state: State<number> }>()</script>'
        const result = compileArrangeSfa(source, join(directory, 'Page.sfa'))
        assert.match(result.code, /refKind: 'writable'/)
        assert.ok(result.dependencies.some(file => file.endsWith('state.ts')))
        assert.ok(result.dependencies.some(file => file.endsWith('barrel.ts')))

        writeFileSync(join(directory, 'a.ts'), 'export type { State } from "./b"')
        writeFileSync(join(directory, 'b.ts'), 'export type { State } from "./a"')
        assert.throws(() => compileArrangeSfa('<script>import type { State } from "./a"; defineProps<{ state: State }>()</script>', join(directory, 'Cycle.sfa')), /类型转导出存在循环/)
    } finally {
        rmSync(directory, { recursive: true })
    }
})


test('错误处理器接收挂载失败后不产生成功生命周期，后续应用仍可挂载', () => {
    for (const phase of ['初始化', '重排', '值求值']) {
        const events: string[] = []
        const Broken = runtime.defineArrangable({ setup() {
            runtime.onMounted(() => events.push('不应成功'))
            runtime.onScopeDispose(() => events.push('已清理'))
            if (phase === '初始化') throw new Error(phase)
            return () => {
                if (phase === '重排') throw new Error(phase)
                return runtime.h(runtime.Text, { text: runtime.arrangeValue(() => { throw new Error(phase) }) })
            }
        } })
        const app = runtime.createApp(Broken)
        app.config.errorHandler = () => events.push('已报告')
        assert.throws(() => app.mount(recordingNative().target), new RegExp(phase))
        assert.ok(events.includes('已清理'))
        assert.ok(!events.includes('不应成功'))
        const healthy = runtime.createApp(runtime.Text, { text: '恢复' })
        const native = recordingNative()
        healthy.mount(native.target)
        assert.ok([...native.nodes.values()].some(node => node.inputs.get('text') === '恢复'))
        healthy.unmount()
    }
})


test('固定参数及动态参数组拒绝时保留真实 SFA 位置', () => {
    for (const parameters of ['unknown="误传"', 'text="文字" :singleLine="123"', 'v-bind="{ text: 123 }"', 'v-bind="{ text: 1, Text: 2 }"']) {
        const Page = evaluateSfa('<template>\n    <Text ' + parameters + ' />\n</template>')
        assert.throws(() => runtime.createApp(Page).mount(recordingNative().target), error => error instanceof Error && /契约.sfa:2:/.test(error.message))
    }
})
