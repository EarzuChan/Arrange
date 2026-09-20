import test from 'node:test'
import assert from 'node:assert/strict'
import { painter, Column, Icon, Text, createApp, defineArrangable, diagnostics, logger, M, nextTick, ref, createScrollState, onScopeDispose } from '../../packages/runtime/src/index.ts'
import type { NativeTransactionTarget, Modifier } from '../../packages/runtime/src/index.ts'
import { recordingNative } from './recordingNative.ts'

function diagnosticNative(): NativeTransactionTarget & { calls: (readonly [string, ...unknown[]])[] } {
    const calls: (readonly [string, ...unknown[]])[] = []
    return {
        ...recordingNative().target,
        calls,
        diagnosticsLog: (level, payload) => calls.push(['diagnosticsLog', level, payload]),
        diagnosticsToast: payload => calls.push(['diagnosticsToast', payload]),
        diagnosticsRequestReload: payload => calls.push(['diagnosticsRequestReload', payload]),
        diagnosticsCopyDiagnostics: () => 'copied',
        diagnosticsCopyRecentEvents: () => 'recent',
        diagnosticsSetLogLevel: level => calls.push(['diagnosticsSetLogLevel', level]),
        diagnosticsSetCategoryEnabled: (category, enabled) => calls.push(['diagnosticsSetCategoryEnabled', category, enabled]),
        diagnosticsSetToastsEnabled: enabled => calls.push(['diagnosticsSetToastsEnabled', enabled]),
    }
}

test('App 经 Layout 结构调用提交原生父子关系、Policy 与 Modifier', () => {
    const native = recordingNative()
    const Root = defineArrangable({ setup: (_props, { call }) => () => call(0, Column, { modifier: () => M.padding(8) }, { default: () => call(0, Text, { text: () => '正文' }) }) })
    const app = createApp(Root)
    app.mount(native.target)
    assert.deepEqual(native.nodes.get(1)!.children, [2])
    assert.deepEqual(native.nodes.get(2)!.children, [3])
    assert.deepEqual(native.textNodes(), [{ id: 3, text: '正文' }])
    assert.equal((native.nodes.get(2)!.inputs.get('modifier') as Modifier).elements[0].type, 'padding')
    assert.ok(native.nodes.get(2)!.inputs.get('measurePolicy'))
    app.unmount()
})

test('反应式文字通过文本 Modifier 更新既有受体', async () => {
    const text = ref('原文')
    const native = recordingNative()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, Text, { text: () => text.value }) }))
    app.mount(native.target)
    const id = native.textNodes()[0].id
    text.value = '新文'
    await nextTick()
    assert.deepEqual(native.textNodes(), [{ id, text: '新文' }])
    app.unmount()
})

test('同批多受体值变化只产生一次候选，等待 apply 期间的新值整体进入下一次提交', async () => {
    const first = ref('甲')
    const second = ref('乙')
    const native = recordingNative(false)
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => {
        call(0, Text, { text: () => first.value })
        call(1, Text, { text: () => second.value })
    } }))
    app.mount(native.target)
    native.finish()
    const initialSubmissions = native.submissions

    first.value = '丙'
    second.value = '丁'
    await nextTick()
    assert.equal(native.submissions, initialSubmissions + 1)
    assert.deepEqual(native.textNodes().map(node => node.text), ['甲', '乙'])

    first.value = '戊'
    second.value = '己'
    await nextTick()
    assert.equal(native.submissions, initialSubmissions + 1)
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['丙', '丁'])
    await nextTick()
    assert.equal(native.submissions, initialSubmissions + 2)
    native.finish()
    await nextTick()
    assert.deepEqual(native.textNodes().map(node => node.text), ['戊', '己'])
    assert.equal(native.submissions, initialSubmissions + 2)
    app.unmount()
})

test('父范围退出时取消同批旧子参数求值，候选内替换的 Layout 不留下原生孤儿', async () => {
    const shown = ref(true)
    const invalid = ref(false)
    const native = recordingNative()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => {
        if (shown.value) call(0, Text, { text: () => {
            if (invalid.value) throw new Error('已退出的参数不应求值')
            return '旧内容'
        } })
    } }))
    app.mount(native.target)
    invalid.value = true
    shown.value = false
    await nextTick()
    assert.equal(native.nodes.size, 1)
    app.unmount()

    const phase = ref(0)
    const Trigger = defineArrangable({ setup: () => () => { if (phase.value === 0) phase.value = 1 } })
    const replacement = createApp(defineArrangable({ setup: (_props, { call }) => () => {
        if (phase.value === 0) call(0, Text, { text: () => '未提交内容' })
        else call(1, Text, { text: () => '最终内容' })
        call(2, Trigger, {})
    } }))
    replacement.mount(native.target)
    assert.equal(native.nodes.size, 2)
    assert.deepEqual(native.textNodes().map(node => node.text), ['最终内容'])
    replacement.unmount()
})

test('原生宿主拒绝双 App，清理异常仍释放宿主以便重新挂载', () => {
    const native = recordingNative()
    const first = createApp(Text, { text: '第一份' })
    const second = createApp(Text, { text: '第二份' })
    first.mount(native.target)
    assert.throws(() => second.mount(native.target), /已经|占用/)
    assert.deepEqual(native.textNodes().map(node => node.text), ['第一份'])
    first.unmount()
    second.mount(native.target)
    assert.deepEqual(native.textNodes().map(node => node.text), ['第二份'])
    second.unmount()

    const failing = createApp(defineArrangable({ setup() {
        onScopeDispose(() => { throw new Error('清理失败') })
        return () => {}
    } }))
    failing.mount(native.target)
    assert.throws(() => failing.unmount(), AggregateError)
    assert.equal(native.nodes.size, 0)
    second.mount(native.target)
    second.unmount()
})

test('ScrollState 接收原生对象快照并更新文本和滚动 Modifier', async () => {
    const native = recordingNative()
    const scroll = createScrollState()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, Column, { modifier: () => M.verticalScroll(scroll) }, { default: () => call(0, Text, { text: () => `滚动 ${scroll.value}` }) }) }))
    app.mount(native.target)
    scroll.__arrangeNativeScroll({ value: 12, maxValue: 40, viewportSize: 80, contentSize: 120 })
    await nextTick()
    assert.equal(native.textNodes()[0].text, '滚动 12')
    assert.equal(scroll.maxValue, 40)
    assert.equal(((native.nodes.get(2)!.inputs.get('modifier') as Modifier).elements[0].value.state as { value: number }).value, 12)
    app.unmount()
})

test('App 拒绝不一致的协议版本', () => {
    assert.throws(() => createApp(Text).mount({ ...recordingNative().target, runtimeVersion: 999 }), /脚本与原生协议版本不一致/)
})

test("诊断 API 交付明确原生入口", () => {
    const native = diagnosticNative()
    globalThis.__ARRANGE_NATIVE__ = native
    try {
        logger.warn({ category: "app", message: "测试警告", detail: "测试详情" })
        diagnostics.toast("提示")
        diagnostics.setLogLevel("error")
        diagnostics.setCategoryEnabled("runtime.script", false)
        diagnostics.setToastsEnabled(false)
        diagnostics.requestReload("src/App.sfa")
        assert.equal(diagnostics.copyDiagnostics(), "copied")
        assert.equal(diagnostics.copyRecentEvents(), "recent")
    } finally {
        delete globalThis.__ARRANGE_NATIVE__
    }
    assert.ok(native.calls.some((call) => call[0] === "diagnosticsLog" && call[1] === "warn"))
    assert.ok(native.calls.some((call) => call[0] === "diagnosticsToast"))
    assert.ok(native.calls.some((call) => call[0] === "diagnosticsSetCategoryEnabled" && call[1] === "runtime.script" && call[2] === false))
    assert.ok(native.calls.some((call) => call[0] === "diagnosticsRequestReload"))
})

test("诊断 API 在原生调用前拒绝非法级别与分类", () => {
    const native = diagnosticNative()
    globalThis.__ARRANGE_NATIVE__ = native
    try {
        assert.throws(() => diagnostics.setLogLevel("verbose" as never), /log level/)
        assert.throws(() => diagnostics.setCategoryEnabled("runtime.fake" as never, true), /category/)
        assert.throws(() => logger.info({ category: "runtime.fake" as never, message: "bad" }), /category/)
    } finally {
        delete globalThis.__ARRANGE_NATIVE__
    }
    assert.deepEqual(native.calls, [])
})

test('Icon 未指定 tint 保留 Painter 原色，指定 tint 只增加 colorFilter', () => {
    const native = recordingNative()
    const retired: bigint[] = []
    native.target.acquirePainter = (_resource, complete) => {
        complete({ contentVersion: 1, width: 24, height: 24 })
        return { identity: 99n, generation: 1n }
    }
    native.target.releasePainter = handle => retired.push(handle.identity)
    const previous = globalThis.__ARRANGE_NATIVE__
    globalThis.__ARRANGE_NATIVE__ = native.target
    try {
        const app = createApp(defineArrangable({ setup(_props, { call }) {
            const image = painter('icons/play.svg')
            return () => {
                call(0, Icon, { painter: () => image })
                call(1, Icon, { painter: () => image, tint: () => 0xffe8eaed })
            }
        } }))
        app.mount(native.target)
        const paints = [...native.nodes.values()].flatMap(node => (node.inputs.get('modifier') as Modifier | undefined)?.elements ?? []).filter(element => element.type === 'paint')
        assert.equal(paints.length, 2)
        assert.equal(paints[0].value.colorFilter, undefined)
        assert.deepEqual(paints[1].value.colorFilter, { tint: 0xffe8eaed })
        app.unmount()
        assert.deepEqual(retired, [99n])
    } finally {
        globalThis.__ARRANGE_NATIVE__ = previous
    }
})
