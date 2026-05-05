import test from "node:test";
import assert from "node:assert/strict";
import { rememberScrollState } from "../../packages/runtime/src/index.mjs";

test("ScrollState mirrors native scroll snapshots", () => {
  const state = rememberScrollState({ initial: 4 });
  assert.equal(state.value, 4);
  assert.equal(state.canScrollBackward, true);
  assert.equal(state.canScrollForward, false);

  state.__arrangeNativeScroll(JSON.stringify({ value: 12, maxValue: 40, viewportSize: 80, contentSize: 120, isScrollInProgress: true }));
  assert.equal(state.value, 12);
  assert.equal(state.maxValue, 40);
  assert.equal(state.viewportSize, 80);
  assert.equal(state.contentSize, 120);
  assert.equal(state.canScrollBackward, true);
  assert.equal(state.canScrollForward, true);
  assert.equal(state.isScrollInProgress, true);

  state.scrollTo(40);
  assert.equal(state.value, 40);
  assert.equal(state.canScrollForward, false);
});

test("ScrollState native callback does not depend on this binding", () => {
  const state = rememberScrollState({ initial: 0 });
  const callback = state.__arrangeNativeScroll;

  callback(JSON.stringify({ value: 7, maxValue: 12, viewportSize: 4, contentSize: 16 }));

  assert.equal(state.value, 7);
  assert.equal(state.maxValue, 12);
  assert.equal(state.viewportSize, 4);
  assert.equal(state.contentSize, 16);
  assert.equal(state.canScrollBackward, true);
  assert.equal(state.canScrollForward, true);
});
