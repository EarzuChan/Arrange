import test from "node:test"
import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {pathToFileURL} from "node:url"
import {Column, Icon, Text, createApp, diagnostics, logger, m, provideContentColor, rememberScrollState} from "../../packages/runtime/src/index.ts"
import type {NativeTransactionTarget} from "../../packages/runtime/src/index.ts"

const requireFromRuntime = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const {h: vueH, nextTick, ref} = await import(pathToFileURL(requireFromRuntime.resolve("vue")).href)

type NativeCall = readonly [string, ...unknown[]]

type RecordingNative = NativeTransactionTarget & {calls: NativeCall[]}

function recordingNative(): RecordingNative {
    const calls: NativeCall[] = []
    return {
        calls,
        runtimeVersion: 1,
        beginTransaction: () => calls.push(["beginTransaction"]),
        endTransaction: () => calls.push(["endTransaction"]),
        createNode: (id, type) => calls.push(["createNode", id, type]),
        deleteNode: (id) => calls.push(["deleteNode", id]),
        insertChild: (parent, child, index) => calls.push(["insertChild", parent, child, index]),
        removeChild: (parent, child) => calls.push(["removeChild", parent, child]),
        setText: (id, text) => calls.push(["setText", id, text]),
        setProp: (id, key, value) => calls.push(["setProp", id, key, value]),
        setModifier: (id, modifier) => calls.push(["setModifier", id, modifier]),
        invalidate: (id, flag, reason) => calls.push(["invalidate", id, flag, reason]),
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
            return () => vueH(Column, {modifier: m.padding(8)}, [vueH(Text, {text: "Hello"})])
        },
    }).mount(native)

    assert.deepEqual(native.calls[0], ["beginTransaction"])
    assert.ok(native.calls.some((call) => call[0] === "createNode" && call[1] === 1 && call[2] === "Column"))
    assert.ok(native.calls.some((call) => call[0] === "createNode" && call[1] === 2 && call[2] === "Text"))
    assert.ok(native.calls.some((call) => call[0] === "setText" && call[1] === 2 && call[2] === "Hello"))
    assert.ok(native.calls.some((call) => call[0] === "setModifier" && call[1] === 1))
    assert.deepEqual(native.calls.at(-1), ["endTransaction"])
})

test("Vue renderer commits reactive text through native setText", async () => {
    const native = recordingNative()
    const label = ref("Alpha")
    createApp({setup: () => () => vueH(Text, {text: label.value})}).mount(native)
    native.calls.length = 0

    label.value = "Beta"
    await flushArrangeCommit()

    assert.deepEqual(native.calls, [["beginTransaction"], ["setText", 1, "Beta"], ["endTransaction"]])
})

test("ScrollState native object snapshots trigger modifier updates without JSON", async () => {
    const native = recordingNative()
    const scrollState = rememberScrollState()
    createApp({
        setup() {
            return () => vueH(Column, {modifier: m.verticalScroll(scrollState)}, [vueH(Text, {text: `scroll ${scrollState.value}`})])
        },
    }).mount(native)
    native.calls.length = 0

    scrollState.__arrangeNativeScroll({value: 12, maxValue: 40, viewportSize: 80, contentSize: 120})
    await flushArrangeCommit()

    assert.ok(native.calls.some((call) => call[0] === "setText" && call[2] === "scroll 12"))
    assert.ok(native.calls.some((call) => call[0] === "setModifier" && call[1] === 1))
})

test("Vue renderer rejects incompatible native runtime version", () => {
    const app = createApp({setup: () => () => vueH(Text, {text: "versioned"})})
    assert.throws(() => app.mount({runtimeVersion: 999}), /runtime\/native version mismatch/)
})

test("diagnostics TS API forwards to native diagnostics functions", () => {
    const native = recordingNative()
    globalThis.__ARRANGE_NATIVE__ = native
    try {
        logger.warn({category: "app", message: "warned", detail: "detail"})
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
        assert.throws(() => logger.info({category: "runtime.fake" as never, message: "bad"}), /category/)
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
            return () => vueH(Column, null, [vueH(Icon, {source: "icons/play.svg"})])
        },
    }).mount(native)

    assert.ok(native.calls.some((call) => call[0] === "setProp" && call[2] === "source" && call[3] === "icons/play.svg"))
    assert.ok(native.calls.some((call) => call[0] === "setProp" && call[2] === "tint" && call[3] === 0xffe8eaed))
})
