import test from "node:test"
import assert from "node:assert/strict"
import { ARRANGE_RUNTIME_VERSION, Column, Icon, Text, createApp, diagnostics, h as vueH, logger, m, nextTick, provideContentColor, ref, createScrollState } from "../../packages/runtime/src/index.ts"
import type { NativeTransactionTarget } from "../../packages/runtime/src/index.ts"

type NativeCall = readonly [string, ...unknown[]]

type RecordingNative = NativeTransactionTarget & { calls: NativeCall[] }

function recordingNative(): RecordingNative {
    const calls: NativeCall[] = []
    const bindings = new Map<bigint, { id: number; input: string }>()
    let nextBinding = 1n
    return {
        calls,
        registerBinding(id, input) {
            const handle = { identity: nextBinding++, generation: 1n }
            bindings.set(handle.identity, { id, input })
            return handle
        },
        updateBinding(handle, value) {
            const target = bindings.get(handle.identity)!
            calls.push(target.input === "modifier" ? ["setModifier", target.id, value] : target.input === "text" ? ["setText", target.id, value] : ["setProp", target.id, target.input, value])
        },
        releaseBinding(handle) { bindings.delete(handle.identity) },
        runtimeVersion: ARRANGE_RUNTIME_VERSION,
        createNode: (id, type) => calls.push(["createNode", id, type]),
        deleteNode: (id) => calls.push(["deleteNode", id]),
        insertChild: (parent, child, index) => calls.push(["insertChild", parent, child, index]),
        removeChild: (parent, child) => calls.push(["removeChild", parent, child]),
        unmount: () => calls.push(["unmount"]),
        diagnosticsLog: (level, payload) => calls.push(["diagnosticsLog", level, payload]),
        diagnosticsToast: (payload) => calls.push(["diagnosticsToast", payload]),
        diagnosticsRequestReload: (payload) => calls.push(["diagnosticsRequestReload", payload]),
        diagnosticsTriggerFakeError: (payload) => calls.push(["diagnosticsTriggerFakeError", payload]),
        diagnosticsCopyDiagnostics: () => "copied",
        diagnosticsCopyRecentEvents: () => "recent",
        diagnosticsSetLogLevel: (level) => calls.push(["diagnosticsSetLogLevel", level]),
        diagnosticsSetCategoryEnabled: (category, enabled) => calls.push(["diagnosticsSetCategoryEnabled", category, enabled]),
        diagnosticsSetToastsEnabled: (enabled) => calls.push(["diagnosticsSetToastsEnabled", enabled]),
    }
}

async function flushArrangeCommit(): Promise<void> {
    await nextTick()
    await Promise.resolve()
}

test("Vue renderer drives native transaction API on mount", () => {
    const native = recordingNative()
    createApp({
        setup() {
            return () => vueH(Column, { modifier: m.padding(8) }, [vueH(Text, { text: "Hello" })])
        },
    }).mount(native)

    assert.deepEqual(native.calls[0], ["createNode", 1, "Root"])
    assert.ok(native.calls.some((call) => call[0] === "createNode" && call[1] === 2 && call[2] === "Column"))
    assert.ok(native.calls.some((call) => call[0] === "createNode" && call[1] === 3 && call[2] === "Text"))
    assert.ok(native.calls.some((call) => call[0] === "setText" && call[1] === 3 && call[2] === "Hello"))
    assert.ok(native.calls.some((call) => call[0] === "setModifier" && call[1] === 2))
})

test("Vue renderer commits reactive text through native setText", async () => {
    const native = recordingNative()
    const label = ref("Alpha")
    createApp({ setup: () => () => vueH(Text, { text: label.value }) }).mount(native)
    native.calls.length = 0

    label.value = "Beta"
    await flushArrangeCommit()

    assert.deepEqual(native.calls, [["setText", 2, "Beta"]])
})

test("ScrollState native object snapshots trigger modifier updates without JSON", async () => {
    const native = recordingNative()
    const scrollState = createScrollState()
    createApp({
        setup() {
            return () => vueH(Column, { modifier: m.verticalScroll(scrollState) }, [vueH(Text, { text: `scroll ${scrollState.value}` })])
        },
    }).mount(native)
    native.calls.length = 0

    scrollState.__arrangeNativeScroll({ value: 12, maxValue: 40, viewportSize: 80, contentSize: 120 })
    await flushArrangeCommit()

    assert.ok(native.calls.some((call) => call[0] === "setText" && call[2] === "scroll 12"))
    assert.ok(native.calls.some((call) => call[0] === "setModifier" && call[1] === 2))
})

test("Vue renderer rejects incompatible native runtime version", () => {
    const app = createApp({ setup: () => () => vueH(Text, { text: "versioned" }) })
    assert.throws(() => app.mount({ ...recordingNative(), runtimeVersion: 999 }), /脚本与原生协议版本不一致/)
})

test("diagnostics TS API forwards to native diagnostics functions", () => {
    const native = recordingNative()
    globalThis.__ARRANGE_NATIVE__ = native
    try {
        logger.warn({ category: "app", message: "warned", detail: "detail" })
        diagnostics.toast("toast")
        diagnostics.setLogLevel("error")
        diagnostics.setCategoryEnabled("runtime.script", false)
        diagnostics.setToastsEnabled(false)
        diagnostics.requestReload("src/App.vue")
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

test("diagnostics TS API rejects unsupported levels and categories before native", () => {
    const native = recordingNative()
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

test("Icon without explicit tint reads LocalContentColor before native commit", () => {
    const native = recordingNative()
    createApp({
        setup() {
            provideContentColor(0xffe8eaed)
            return () => vueH(Column, null, [vueH(Icon, { source: "icons/play.svg" })])
        },
    }).mount(native)

    assert.ok(native.calls.some((call) => call[0] === "setProp" && call[2] === "source" && (call[3] as {path?: string}).path === "icons/play.svg"))
    assert.ok(native.calls.some((call) => call[0] === "setProp" && call[2] === "tint" && call[3] === 0xffe8eaed))
})
