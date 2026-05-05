import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Row, Column, Text, Box, m, dp, Color, rememberScrollState, encodeBridgeBatch, decodeBridgeBatch } from "../../packages/runtime/src/index.mjs";
import { h, renderToBridgeOps, renderToBridgeBatch } from "../../packages/runtime/src/test/index.mjs";
import { createApp } from "../../packages/runtime/src/app.mjs";

const requireFromRuntime = createRequire(new URL("../../packages/runtime/package.json", import.meta.url));
const { h: vueH, nextTick, ref } = await import(pathToFileURL(requireFromRuntime.resolve("vue")).href);

function stripRuntimeLinks(node) {
  if (node == null) return null;
  return {
    type: node.type,
    props: node.props,
    children: (node.children ?? []).map(stripRuntimeLinks),
  };
}

function stripCommit(entry) {
  if (!("tree" in entry)) return entry;
  return { ...entry, tree: stripRuntimeLinks(entry.tree) };
}

async function flushArrangeCommit() {
  await nextTick();
  await Promise.resolve();
}

test("headless renderer records create/set/insert ops for Arrange tree", () => {
  const ops = renderToBridgeOps(() => h(Column, { modifier: m.padding(dp(8)).testTag("root") }, [
    h(Text, { text: "Hello", modifier: m.testTag("title") }),
    h(Box, { modifier: m.size(dp(10), dp(20)).background(Color(0xFF000000)).testTag("box") }),
  ]));
  assert.deepEqual(ops.filter((op) => op.op !== "setProp").map((op) => op.op), [
    "createNode", "setModifier",
    "createNode", "setText", "setModifier", "insertChild",
    "createNode", "setModifier", "insertChild",
  ]);
  assert.deepEqual(ops[0], { op: "createNode", id: 1, nodeType: "Column" });
  assert.deepEqual(ops.find((op) => op.op === "createNode" && op.id === 2), { op: "createNode", id: 2, nodeType: "Text" });
  assert.deepEqual(ops.find((op) => op.op === "insertChild" && op.child === 2), { op: "insertChild", parent: 1, child: 2, index: 0 });
  assert.ok(ops.some((op) => op.op === "setProp" && op.key === "__arrangeModifierCount" && op.value === 2));
  assert.ok(ops.some((op) => op.op === "setProp" && op.key === "__arrangeModifier.0.type" && op.value === "padding"));
});

test("recorded renderer ops can be encoded into Bridge command buffer", () => {
  const ops = renderToBridgeOps(() => h(Text, { text: "Bridge" }));
  const decoded = decodeBridgeBatch(encodeBridgeBatch(ops));
  assert.deepEqual(decoded.ops, ops);
});

test("renderer assigns callback handles for clickable modifiers", () => {
  const onClick = () => {};
  const batch = renderToBridgeBatch(() => h(Box, { modifier: m.clickable(onClick).testTag("button") }));
  assert.equal(batch.callbacks.length, 1);
  assert.equal(batch.callbacks[0].handle, 1);
  assert.equal(batch.callbacks[0].callback, onClick);
  const modifierOp = batch.ops.find((op) => op.op === "setModifier");
  assert.equal(modifierOp.modifier[0].type, "clickable");
  assert.equal(modifierOp.modifier[0].onClick.callbackHandle, 1);
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeClickableEnabled" && op.value === true));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeClickCallback" && op.value.callbackHandle === 1));
});

test("renderer emits typed weight props beside modifier debug payload", () => {
  const batch = renderToBridgeBatch(() => h(Row, {}, [
    h(Box, { modifier: m.weight(2, { fill: false }) }),
  ]));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeWeight" && op.value === 2));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeWeightFill" && op.value === false));
});

test("renderer emits typed align, zIndex, layout offset and layer transform props beside modifier debug payload", () => {
  const batch = renderToBridgeBatch(() => h(Box, { modifier: m.align("BottomEnd").zIndex(9).offset({ x: 3, y: 4 }).graphicsLayer({ translationX: 5, translationY: 6, scaleX: 2, scaleY: 3, rotationZ: 15, transformOrigin: "TopStart" }) }));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeAlign" && op.value === "BottomEnd"));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeZIndex" && op.value === 9));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayoutOffsetX" && op.value === 8));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayoutOffsetY" && op.value === 10));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayerScaleX" && op.value === 2));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayerScaleY" && op.value === 3));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayerRotationZ" && op.value === 15));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayerTransformOriginX" && op.value === 0));
  assert.ok(batch.ops.some((op) => op.op === "setProp" && op.key === "__arrangeLayerTransformOriginY" && op.value === 0));
});

test("Vue custom renderer commits updated Arrange tree after reactive prop changes", async () => {
  const label = ref("Alpha");
  const commits = [];
  createApp({
    setup() {
      return () => vueH(Text, { text: label.value, modifier: m.testTag("dynamic-label") });
    },
  }).mount({ commit: (batch) => commits.push(batch.map(stripCommit)) });

  assert.equal(commits.at(-1)[0].tree.props.text, "Alpha");

  label.value = "Beta";
  await flushArrangeCommit();

  assert.equal(commits.at(-1).some((entry) => entry.op === "mount"), false);
  assert.ok(commits.at(-1).some((entry) => entry.op === "setText" && entry.id === 1 && entry.text === "Beta"));
});

test("Vue custom renderer commits child removal and unmount", async () => {
  const visible = ref(true);
  const commits = [];
  const app = createApp({
    setup() {
      return () => vueH(Column, { modifier: m.testTag("root") }, visible.value ? [vueH(Text, { text: "child" })] : []);
    },
  });

  app.mount({ commit: (batch) => commits.push(batch.map(stripCommit)) });
  assert.equal(commits.at(-1)[0].tree.children.length, 1);

  visible.value = false;
  await flushArrangeCommit();
  assert.equal(commits.at(-1).some((entry) => entry.op === "mount"), false);
  assert.ok(commits.at(-1).some((entry) => entry.op === "removeChild" && entry.parent === 1 && entry.child === 2));
  assert.ok(commits.at(-1).some((entry) => entry.op === "deleteNode" && entry.id === 2));

  app.unmount();
  assert.equal(commits.at(-1)[0].op, "unmount");
});

test("Vue custom renderer resets typed layer props when graphicsLayer is removed", async () => {
  const useLayer = ref(true);
  const commits = [];
  createApp({
    setup() {
      return () => vueH(Box, {
        modifier: useLayer.value
          ? m.graphicsLayer({ scaleX: 2, scaleY: 3, rotationZ: 15, transformOrigin: "TopStart" })
          : m,
      });
    },
  }).mount({ commit: (batch) => commits.push(batch.map(stripCommit)) });

  useLayer.value = false;
  await flushArrangeCommit();

  assert.ok(commits.at(-1).some((entry) => entry.op === "setModifier" && entry.id === 1));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeLayerScaleX" && entry.value === 1));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeLayerScaleY" && entry.value === 1));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeLayerRotationZ" && entry.value === 0));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeLayerTransformOriginX" && entry.value === 0.5));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeLayerTransformOriginY" && entry.value === 0.5));
});

test("ScrollState native snapshots trigger Vue renderer updates", async () => {
  const scrollState = rememberScrollState();
  const commits = [];
  createApp({
    setup() {
      return () => vueH(Column, { modifier: m.verticalScroll(scrollState).testTag("scroller") }, [
        vueH(Text, { text: `scroll ${scrollState.value}` }),
      ]);
    },
  }).mount({ commit: (batch) => commits.push(batch.map(stripCommit)) });

  scrollState.__arrangeNativeScroll({ value: 12, maxValue: 40, viewportSize: 80, contentSize: 120 });
  await flushArrangeCommit();

  assert.equal(commits.at(-1).some((entry) => entry.op === "mount"), false);
  assert.ok(commits.at(-1).some((entry) => entry.op === "setText" && entry.text === "scroll 12"));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setModifier" && entry.id === 1));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeVerticalScrollEnabled" && entry.value === true));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeVerticalScrollValue" && entry.value === 12));
  assert.ok(commits.at(-1).some((entry) => entry.op === "setProp" && entry.key === "__arrangeVerticalScrollCallback" && entry.value === scrollState.__arrangeNativeScroll));
});

test("Vue custom renderer rejects incompatible native bridge version", () => {
  const app = createApp({
    setup() {
      return () => vueH(Text, { text: "versioned" });
    },
  });

  assert.throws(
    () => app.mount({ protocolVersion: 999, commit() {} }),
    /bridge version mismatch/,
  );
});
