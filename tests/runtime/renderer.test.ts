import test from "node:test"
import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {pathToFileURL} from "node:url"
import {Column, Text, createApp, m, rememberScrollState} from "../../packages/runtime/src/index.ts"
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
