import test from "node:test";
import assert from "node:assert/strict";
import { ARRANGE_HMR_RELOAD_EVENT, installArrangeHmrClient } from "../../packages/runtime/src/index.mjs";

test("Arrange HMR client forwards Vite reload payloads to native runtime", () => {
  const handlers = new Map();
  const hot = { on(event, callback) { handlers.set(event, callback); } };
  const reloads = [];
  const installed = installArrangeHmrClient(hot, { reload(payload) { reloads.push(payload); } });

  assert.equal(installed, true);
  assert.equal(typeof handlers.get(ARRANGE_HMR_RELOAD_EVENT), "function");

  handlers.get(ARRANGE_HMR_RELOAD_EVENT)({ path: "src/App.vue", timestamp: 1 });
  assert.deepEqual(reloads, [{ path: "src/App.vue", timestamp: 1 }]);
});

test("Arrange HMR client is inert when no Vite hot object is available", () => {
  assert.equal(installArrangeHmrClient(null, { reload() { throw new Error("must not reload"); } }), false);
});
