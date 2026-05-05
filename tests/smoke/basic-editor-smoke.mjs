import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeBridgeBatch } from "../../packages/runtime/src/index.mjs";

const bridgePath = resolve("demo/plugin-src/ui/app.bridge.bin");
const bytes = await readFile(bridgePath);
const batch = decodeBridgeBatch(bytes);

assert.equal(batch.header.opCount, batch.ops.length);
assert.equal(batch.header.opCount >= 40, true);
assert.equal(batch.ops[0].nodeType, "Column");
assert.equal(batch.ops.some((op) => op.nodeType === "Icon"), true);
assert.equal(batch.ops.some((op) => op.nodeType === "Image"), true);
assert.equal(batch.ops.some((op) => op.key === "source" && op.value === "logo.png"), true);
assert.equal(batch.ops.some((op) => op.text === "Arrange Demo"), true);
assert.equal(batch.ops.some((op) => op.text === "Clicks: 0"), true);
assert.equal(batch.ops.some((op) => op.nodeType === "Input"), true);
assert.equal(batch.ops.some((op) => (op.key === "modelValue" || op.key === "model-value") && op.value === "Preset A"), true);
assert.equal(batch.ops.some((op) => op.modifier?.some?.((element) => element.type === "verticalScroll")), true);
assert.equal(batch.ops.some((op) => op.text === "Scroll viewport"), true);
assert.equal(batch.ops.some((op) => op.text && op.text.includes("Vue SFC authoring")), true);
console.log(JSON.stringify({ bridgePath, opCount: batch.header.opCount }, null, 2));
