import test from "node:test"
import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {pathToFileURL} from "node:url"
import {Row, Column, Text, Box, m, dp, Color, rememberScrollState, encodeBridgeBatch, decodeBridgeBatch} from "../../packages/runtime/src/index.ts"
import type {BridgeOp, NativeCommitCommand} from "../../packages/runtime/src/index.ts"
import type {ArrangeHostNode} from "../../packages/runtime/src/types.ts"
import type {SerializedModifier} from "../../packages/runtime/src/renderer.ts"
import {h, renderToBridgeOps, renderToBridgeBatch} from "../../packages/runtime/src/test/index.ts"
import {createApp} from "../../packages/runtime/src/app.ts"

const requireFromRuntime = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const {h: vueH, nextTick, ref} = await import(pathToFileURL(requireFromRuntime.resolve("vue")).href)

type SanitizedCommit = BridgeOp | NativeCommitCommand

function stripCommit(entry: BridgeOp | NativeCommitCommand): SanitizedCommit {
    return entry
}

function assertNoDerivedModifierProps(ops: readonly SanitizedCommit[]): void {
    const forbiddenPrefixes = [
        "__arrangeClickable",
        "__arrangeClickEventSlot",
        "__arrangeVerticalScroll",
        "__arrangeHorizontalScroll",
        "__arrangeWeight",
        "__arrangeAlign",
        "__arrangeZIndex",
        "__arrangeLayoutOffset",
        "__arrangeLayer",
    ]
    for (const op of ops) {
        if (op.op !== "setProp") continue
        assert.equal(forbiddenPrefixes.some((prefix) => op.key.startsWith(prefix)), false, `forbidden derived modifier prop: ${op.key}`)
    }
}

async function flushArrangeCommit(): Promise<void> {
    await nextTick()
    await Promise.resolve()
}

test("headless renderer records create/set/insert ops for Arrange tree", () => {
    const ops = renderToBridgeOps(() => h(Column, {modifier: m.padding(dp(8)).testTag("root")}, [
        h(Text, {text: "Hello", modifier: m.testTag("title")}),
        h(Box, {modifier: m.size(dp(10), dp(20)).background(Color(0xFF000000)).testTag("box")}),
    ]))
    assert.deepEqual(ops.filter((op) => op.op !== "setProp").map((op) => op.op), [
        "createNode", "setModifier",
        "createNode", "setText", "setModifier", "insertChild",
        "createNode", "setModifier", "insertChild",
    ])
    assert.deepEqual(ops[0], {op: "createNode", id: 1, nodeType: "Column"})
    assert.deepEqual(ops.find((op) => op.op === "createNode" && op.id === 2), {op: "createNode", id: 2, nodeType: "Text"})
    assert.deepEqual(ops.find((op) => op.op === "insertChild" && op.child === 2), {op: "insertChild", parent: 1, child: 2, index: 0})
    assert.ok(ops.some((op) => op.op === "setModifier" && op.id === 1))
    assert.ok(ops.some((op) => op.op === "setModifier" && op.id === 2))
    assert.ok(ops.some((op) => op.op === "setModifier" && op.id === 3))
    assert.ok(!ops.some((op) => op.op === "setProp" && (op.key === "__arrangeModifierCount" || op.key.startsWith("__arrangeModifier."))))
})

test("recorded renderer ops can be encoded into Bridge command buffer", () => {
    const ops = renderToBridgeOps(() => h(Text, {text: "Bridge"}))
    const decoded = decodeBridgeBatch(encodeBridgeBatch(ops))
    assert.deepEqual(decoded.ops, ops)
})

test("renderer serializes clickable Modifier only through setModifier", () => {
    const onClick = () => {
    }
    const batch = renderToBridgeBatch(() => h(Box, {modifier: m.clickable(onClick).testTag("button")}))
    assert.equal("eventSlots" in batch, false)
    assertNoDerivedModifierProps(batch.ops)
    const modifierOp = batch.ops.find((op) => op.op === "setModifier")
    assert.ok(modifierOp && modifierOp.op === "setModifier")
    const modifier = modifierOp.modifier as SerializedModifier
    assert.equal(modifier[0]?.type, "clickable")
    assert.deepEqual(modifier[0]?.onClick, {eventSlot: "1:click:click", callback: onClick})
})

test("renderer does not expand weight/align/zIndex/offset/layer Modifier into derived props", () => {
    const batch = renderToBridgeBatch(() => h(Row, {}, [
        h(Box, {modifier: m.weight(2, {fill: false}).align("BottomEnd").zIndex(9).offset({x: 3, y: 4}).graphicsLayer({translationX: 5, translationY: 6, scaleX: 2, scaleY: 3, rotationZ: 15, transformOrigin: "TopStart"})}),
    ]))
    assertNoDerivedModifierProps(batch.ops)
    const childModifier = batch.ops.find((op) => op.op === "setModifier" && op.id === 2)
    assert.ok(childModifier && childModifier.op === "setModifier")
    const modifier = childModifier.modifier as SerializedModifier
    assert.deepEqual(modifier.map((entry) => entry.type), ["weight", "align", "zIndex", "offset", "graphicsLayer"])
})

test("Vue custom renderer commits updated Arrange tree after reactive prop changes", async () => {
    const label = ref("Alpha")
    const commits: SanitizedCommit[][] = []
    createApp({
        setup() {
            return () => vueH(Text, {text: label.value, modifier: m.testTag("dynamic-label")})
        },
    }).mount({commit: (batch: Array<BridgeOp | NativeCommitCommand>) => commits.push(batch.map(stripCommit))})

    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "createNode" && entry.id === 1))
    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "setText" && entry.id === 1 && entry.text === "Alpha"))
    assertNoDerivedModifierProps(commits.at(-1) ?? [])

    label.value = "Beta"
    await flushArrangeCommit()

    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "setText" && entry.id === 1 && entry.text === "Beta"))
})

test("Vue custom renderer commits child removal and unmount", async () => {
    const visible = ref(true)
    const commits: SanitizedCommit[][] = []
    const app = createApp({
        setup() {
            return () => vueH(Column, {modifier: m.testTag("root")}, visible.value ? [vueH(Text, {text: "child"})] : [])
        },
    })

    app.mount({commit: (batch: Array<BridgeOp | NativeCommitCommand>) => commits.push(batch.map(stripCommit))})
    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "createNode" && entry.id === 2))
    assertNoDerivedModifierProps(commits.at(-1) ?? [])

    visible.value = false
    await flushArrangeCommit()
    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "removeChild" && entry.parent === 1 && entry.child === 2))
    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "deleteNode" && entry.id === 2))

    app.unmount()
    assert.equal(commits.at(-1)?.[0]?.op, "unmount")
})

test("Vue custom renderer updates graphicsLayer by setModifier only", async () => {
    const useLayer = ref(true)
    const commits: SanitizedCommit[][] = []
    createApp({
        setup() {
            return () => vueH(Box, {
                modifier: useLayer.value
                    ? m.graphicsLayer({scaleX: 2, scaleY: 3, rotationZ: 15, transformOrigin: "TopStart"})
                    : m,
            })
        },
    }).mount({commit: (batch: Array<BridgeOp | NativeCommitCommand>) => commits.push(batch.map(stripCommit))})

    useLayer.value = false
    await flushArrangeCommit()

    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "setModifier" && entry.id === 1))
    assertNoDerivedModifierProps(commits.at(-1) ?? [])
})

test("ScrollState native snapshots trigger Vue renderer updates", async () => {
    const scrollState = rememberScrollState()
    const commits: SanitizedCommit[][] = []
    createApp({
        setup() {
            return () => vueH(Column, {modifier: m.verticalScroll(scrollState).testTag("scroller")}, [
                vueH(Text, {text: `scroll ${scrollState.value}`}),
            ])
        },
    }).mount({commit: (batch: Array<BridgeOp | NativeCommitCommand>) => commits.push(batch.map(stripCommit))})

    scrollState.__arrangeNativeScroll({value: 12, maxValue: 40, viewportSize: 80, contentSize: 120})
    await flushArrangeCommit()

    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "setText" && entry.text === "scroll 12"))
    assert.ok((commits.at(-1) ?? []).some((entry) => entry.op === "setModifier" && entry.id === 1))
    assertNoDerivedModifierProps(commits.at(-1) ?? [])
    const modifierOp = (commits.at(-1) ?? []).find((entry) => entry.op === "setModifier" && entry.id === 1)
    assert.ok(modifierOp && modifierOp.op === "setModifier")
    const modifier = modifierOp.modifier as SerializedModifier
    assert.equal(modifier[0]?.type, "verticalScroll")
    assert.equal((modifier[0]?.state as {value?: number})?.value, 12)
})

test("Vue custom renderer rejects incompatible native bridge version", () => {
    const app = createApp({
        setup() {
            return () => vueH(Text, {text: "versioned"})
        },
    })

    assert.throws(
        () => app.mount({
            protocolVersion: 999, commit() {
            }
        }),
        /bridge version mismatch/,
    )
})
