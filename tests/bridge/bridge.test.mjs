import test from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_MAGIC, BRIDGE_VERSION, encodeBridgeBatch, decodeBridgeBatch } from "../../packages/runtime/src/index.mjs";

test("bridge command buffer has stable header and roundtrips basic ops", () => {
  const ops = [
    { op: "createNode", id: 1, nodeType: "Box" },
    { op: "setText", id: 2, text: "Hello" },
    { op: "insertChild", parent: 1, child: 2, index: 0 },
  ];
  const bytes = encodeBridgeBatch(ops);
  const decoded = decodeBridgeBatch(bytes);
  assert.equal(decoded.header.magic, BRIDGE_MAGIC);
  assert.equal(decoded.header.version, BRIDGE_VERSION);
  assert.equal(decoded.header.opCount, 3);
  assert.deepEqual(decoded.ops, ops);
});
