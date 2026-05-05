import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { animateColorAsState, animateDpAsState, animateFloatAsState, createManualAnimationClock, updateTransition } from "../../packages/runtime/src/index.mjs";

const requireFromRuntime = createRequire(new URL("../../packages/runtime/package.json", import.meta.url));
const { ref } = await import(pathToFileURL(requireFromRuntime.resolve("vue")).href);

test("animateFloatAsState follows target changes with a deterministic clock", () => {
  const clock = createManualAnimationClock();
  const target = ref(0);
  const animated = animateFloatAsState(target, { durationMillis: 100, clock });

  target.value = 10;
  clock.advanceBy(50);
  assert.equal(animated.value, 5);
  clock.advanceBy(50);
  assert.equal(animated.value, 10);

  animated.stop();
});

test("animateDpAsState uses the same numeric dp timeline", () => {
  const clock = createManualAnimationClock();
  const target = ref(8);
  const animated = animateDpAsState(target, { durationMillis: 80, clock });

  target.value = 24;
  clock.advanceBy(20);
  assert.equal(animated.value, 12);
  clock.advanceBy(60);
  assert.equal(animated.value, 24);

  animated.stop();
});

test("animateColorAsState interpolates ARGB channels", () => {
  const clock = createManualAnimationClock();
  const target = ref(0xff000000);
  const animated = animateColorAsState(target, { durationMillis: 100, clock });

  target.value = 0xffffffff;
  clock.advanceBy(50);
  assert.equal(animated.value, 0xff808080);
  clock.advanceBy(50);
  assert.equal(animated.value, 0xffffffff);

  animated.stop();
});

test("updateTransition derives animated values from a reactive target state", () => {
  const clock = createManualAnimationClock();
  const open = ref(false);
  const transition = updateTransition(open, { durationMillis: 100, clock });
  const width = transition.animateDp("width", (state) => state ? 200 : 100);

  open.value = true;
  clock.advanceBy(25);
  assert.equal(width.value, 125);
  clock.advanceBy(75);
  assert.equal(width.value, 200);

  width.stop();
});
