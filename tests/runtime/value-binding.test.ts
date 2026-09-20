import test from 'node:test'
import assert from 'node:assert/strict'
import * as runtime from '../../packages/runtime/src/index.ts'
import { recordingNative } from './recordingNative.ts'

const flush = () => runtime.nextTick()

test('定义拒绝 Options 配置，setup 必须返回结构程序', () => {
    for (const key of ['data', 'computed', 'methods', 'watch', 'created', 'mounted', 'mixins', 'extends', 'inject', 'provide', 'expose', 'template', 'render', 'compilerOptions']) {
        assert.throws(() => runtime.defineArrangable({ [key]: {}, setup: () => () => {} }), new RegExp(key))
    }
    const invalid = runtime.defineArrangable({ setup: (() => ({})) as never })
    assert.throws(() => runtime.createApp(invalid).mount(recordingNative().target), /结构执行函数/)
})

test('内部 Arrangable 调用只接受 prop getter，裸值不会进入兼容分支', () => {
    const Broken = runtime.defineArrangable({
        props: { text: String },
        setup: (props, { call }) => () => call(0, runtime.Text, { text: props.text as never }),
    })
    assert.throws(() => runtime.createApp(Broken).mount(recordingNative().target), /必须提供求值函数/)
})

test('默认参数、显式函数参数和 setup 局部状态参与统一生命周期', async () => {
    const native = recordingNative()
    const events: number[] = []
    const life: string[] = []
    let increment: () => void
    const Counter = runtime.defineArrangable({
        props: { count: { type: Number, default: 2 }, onChange: Function as runtime.PropType<(value: number) => void> },
        setup(props, { call }) {
            const value = runtime.ref(props.count)
            increment = () => { value.value++; props.onChange?.(value.value) }
            runtime.onMounted(() => life.push('挂载'))
            runtime.onUnmounted(() => life.push('卸载'))
            return () => call(0, runtime.Text, { text: () => String(value.value) })
        },
    })
    const app = runtime.createApp(Counter, { onChange: (value: number) => events.push(value) })
    app.mount(native.target)
    assert.equal(native.textNodes()[0].text, '2')
    increment!()
    await flush()
    assert.equal(native.textNodes()[0].text, '3')
    assert.deepEqual(events, [3])
    app.unmount()
    assert.deepEqual(life, ['挂载', '卸载'])
})

test('setup 中的 watch 随逻辑生命退休', async () => {
    const count = runtime.ref(0)
    const values: number[] = []
    const App = runtime.defineArrangable({ setup() {
        runtime.watch(count, value => values.push(value))
        return () => {}
    } })
    const app = runtime.createApp(App)
    app.mount(recordingNative().target)
    count.value = 1
    await flush()
    app.unmount()
    count.value = 2
    await flush()
    assert.deepEqual(values, [1])
})

test('style 和 class 只是用户显式声明的普通参数，跨层 computed 值不重排包装', async () => {
    const style = runtime.ref('初始')
    const Styled = runtime.defineArrangable({
        props: { style: String, class: String },
        setup(props, { call }) {
            const label = runtime.computed(() => `${props.style}/${props.class}`)
            return () => call(0, runtime.Text, { text: () => label.value })
        },
    })
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, Styled, { style: () => style.value, class: () => '自定义分类' }) })
    const native = recordingNative()
    const app = runtime.createApp(App)
    app.mount(native.target)
    const runs = runtime.getArrangeExecutionStats().structureRuns
    style.value = '更新'
    await flush()
    assert.equal(native.textNodes()[0].text, '更新/自定义分类')
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, runs)
    app.unmount()
})

test('Modifier 未被内部使用时没有隐式受体，显式交付多个 Layout 时各自拥有实例', () => {
    const Wrapper = runtime.defineArrangable({ props: { modifier: runtime.Modifier }, setup: () => () => {} })
    const native = recordingNative()
    const empty = runtime.createApp(Wrapper, { modifier: runtime.M.width(20) })
    empty.mount(native.target)
    assert.equal(native.nodes.size, 1)
    empty.unmount()

    const Shared = runtime.defineArrangable({ setup: (_props, { call }) => () => {
        call(0, runtime.Box, { modifier: () => runtime.M.width(20) })
        call(1, runtime.Box, { modifier: () => runtime.M.width(20) })
    } })
    const app = runtime.createApp(Shared)
    app.mount(native.target)
    const nodes = [...native.nodes.values()].filter(node => node.type === 'LayoutNode')
    assert.equal(nodes.length, 2)
    assert.notEqual(nodes[0].modifiers[0].identity, nodes[1].modifiers[0].identity)
    app.unmount()
})

test('分支退出取消其待处理值任务，反复建立和退休不累积值订阅', async () => {
    const visible = runtime.ref(true)
    const value = runtime.ref(0)
    let reads = 0
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => {
        if (visible.value) call(0, runtime.Text, { text: () => { reads++; return String(value.value) } })
    } })
    const before = runtime.getArrangeExecutionStats().activeValueBindings
    const native = recordingNative()
    const app = runtime.createApp(App)
    app.mount(native.target)
    for (let index = 0; index < 20; index++) {
        value.value++
        visible.value = false
        await flush()
        assert.equal(native.textNodes().length, 0)
        assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, before)
        const previous = reads
        value.value++
        await flush()
        assert.equal(reads, previous)
        visible.value = true
        await flush()
    }
    app.unmount()
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, before)
})

test('同一 Ref 同时驱动结构和值时保留 keyed 实例并交付最终值', async () => {
    const value = runtime.ref(1)
    let created = 0
    const Child = runtime.defineArrangable({ props: { value: Number }, setup(props, { call }) {
        created++
        return () => call(0, runtime.Text, { text: () => String(props.value) })
    } })
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => {
        if (value.value > 0) call(0, Child, { value: () => value.value }, {}, { key: '固定身份' })
    } })
    const native = recordingNative()
    const app = runtime.createApp(App)
    app.mount(native.target)
    const id = native.textNodes()[0].id
    value.value = 2
    await flush()
    assert.equal(created, 1)
    assert.deepEqual(native.textNodes(), [{ id, text: '2' }])
    app.unmount()
})

test('显式函数参数作为值更新，调用次数完全由接收方决定', async () => {
    const events: string[] = []
    const callback = runtime.shallowRef(() => events.push('原回调'))
    let invoke: () => void
    const Receiver = runtime.defineArrangable({ props: { onConfirm: { type: Function as runtime.PropType<() => void>, required: true } }, setup(props) {
        invoke = () => { props.onConfirm(); props.onConfirm() }
        return () => {}
    } })
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, Receiver, { onConfirm: () => callback.value }) })
    const app = runtime.createApp(App)
    app.mount(recordingNative().target)
    const runs = runtime.getArrangeExecutionStats().structureRuns
    invoke!()
    callback.value = () => events.push('新回调')
    await flush()
    invoke!()
    assert.deepEqual(events, ['原回调', '原回调', '新回调', '新回调'])
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, runs)
    app.unmount()
})

test('动态目标替换退休旧任务，参数经过目标声明校验', async () => {
    const selected = runtime.shallowRef<runtime.ArrangableDefinition>(runtime.Text)
    const params = runtime.shallowRef<Record<string, unknown>>({ text: '正文' })
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.DynamicArrangable, { is: () => selected.value, props: () => params.value }) })
    const native = recordingNative()
    const app = runtime.createApp(App)
    app.mount(native.target)
    selected.value = runtime.Spacer
    params.value = {}
    await flush()
    assert.equal(native.textNodes().length, 0)
    assert.equal(native.nodes.size, 2)
    app.unmount()
})

test('值求值异常保留已提交文本，后续依赖变化可重试', async () => {
    const value = runtime.ref(0)
    const errors: unknown[] = []
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.Text, { text: () => {
        if (value.value === 1) throw new Error('值求值失败')
        return String(value.value)
    } }) })
    const native = recordingNative()
    const app = runtime.createApp(App)
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    value.value = 1
    await flush()
    assert.equal(errors.length, 1)
    assert.equal(native.textNodes()[0].text, '0')
    value.value = 2
    await flush()
    assert.equal(native.textNodes()[0].text, '2')
    app.unmount()
})

test('相等结果抑制原生写入且不重排', async () => {
    const value = runtime.ref(0)
    const native = recordingNative()
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.Text, { text: () => String(value.value % 2) }) })
    const app = runtime.createApp(App)
    app.mount(native.target)
    const writes = native.writes
    const runs = runtime.getArrangeExecutionStats().structureRuns
    value.value = 2
    await flush()
    assert.equal(native.writes, writes)
    assert.equal(runtime.getArrangeExecutionStats().structureRuns, runs)
    app.unmount()
})

test('递归 watcher 中止当前刷新而不无限占用帧', async () => {
    const value = runtime.ref(0)
    const stop = runtime.watch(value, () => { value.value++ })
    value.value++
    try {
        await assert.rejects(flush(), /超过调度执行上限/)
        assert.ok(value.value < 200)
    } finally { stop() }
    await flush()
})

test('AnimatedVisibility 保留退出结构、禁用交互并在卸载时取消动画', async () => {
    const native = recordingNative()
    const clock = runtime.createManualAnimationClock()
    const visible = runtime.ref(true)
    const baseline = runtime.animationStats.activeAnimations
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.AnimatedVisibility, {
        visible: () => visible.value,
        clock: () => clock,
        animationSpec: () => runtime.tween({ durationMillis: 100, easing: runtime.linearEasing }),
    }, { default: () => call(0, runtime.Text, { text: () => '退出内容' }) }) })
    const app = runtime.createApp(App)
    app.mount(native.target)
    const count = native.nodes.size
    visible.value = false
    await flush()
    assert.equal(native.nodes.size, count)
    assert.equal(native.nodes.get(2)!.inputs.get('enabled'), false)
    clock.advanceBy(40)
    await flush()
    assert.equal(native.nodes.size, count)
    visible.value = true
    await flush()
    clock.advanceBy(100)
    await flush()
    assert.equal(native.nodes.size, count)
    visible.value = false
    await flush()
    clock.advanceBy(100)
    await flush()
    assert.equal(native.nodes.size, 1)
    visible.value = true
    await flush()
    app.unmount()
    assert.equal(clock.pendingFrames, 0)
    assert.equal(runtime.animationStats.activeAnimations, baseline)
})

test('Crossfade 保留退出页参数，中断恢复旧页不重复创建逻辑实例', async () => {
    const native = recordingNative()
    const clock = runtime.createManualAnimationClock()
    const selected = runtime.ref('A')
    const App = runtime.defineArrangable({ setup: (_props, { call }) => () => call(0, runtime.Crossfade, {
        is: () => runtime.Text,
        props: () => ({ text: selected.value }),
        targetState: () => selected.value,
        clock: () => clock,
        animationSpec: () => runtime.tween({ durationMillis: 100, easing: runtime.linearEasing }),
    }) })
    const app = runtime.createApp(App)
    app.mount(native.target)
    await flush()
    const first = native.textNodes()[0]
    selected.value = 'B'
    await flush()
    assert.deepEqual(native.textNodes().map(node => node.text), ['A', 'B'])
    clock.advanceBy(40)
    await flush()
    selected.value = 'A'
    await flush()
    assert.equal(native.textNodes()[0].id, first.id)
    clock.advanceBy(100)
    await flush()
    assert.deepEqual(native.textNodes(), [first])
    selected.value = 'C'
    await flush()
    app.unmount()
    assert.equal(clock.pendingFrames, 0)
})
