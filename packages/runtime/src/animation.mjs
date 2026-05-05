import { isRef, ref, watch } from "vue";

function defaultNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  if (typeof requestAnimationFrame === "function" || typeof setTimeout === "function") return Date.now();
  return 0;
}

export const linearEasing = (fraction) => fraction;

export const defaultAnimationClock = Object.freeze({
  now: defaultNow,
  requestFrame(callback) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    if (typeof setTimeout === "function") return setTimeout(() => callback(defaultNow()), 16);
    throw new Error("Arrange animation requires a native frame clock or a test clock");
  },
  cancelFrame(handle) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else if (typeof clearTimeout === "function") clearTimeout(handle);
  },
});

export function createManualAnimationClock() {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    advanceBy(deltaMillis) {
      time += deltaMillis;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

function readTarget(target) {
  return isRef(target) ? target.value : typeof target === "function" ? target() : target;
}

function watchTarget(target, callback) {
  if (isRef(target) || typeof target === "function") return watch(target, callback, { flush: "sync" });
  return () => {};
}

function animateNumberAsState(target, args = {}, interpolate = (from, to, fraction) => from + (to - from) * fraction) {
  const clock = args.clock ?? defaultAnimationClock;
  const durationMillis = Math.max(0, args.durationMillis ?? 300);
  const easing = args.easing ?? linearEasing;
  const state = ref(Number(readTarget(target)) || 0);

  let frameHandle = 0;
  let from = state.value;
  let to = state.value;
  let startTime = clock.now();

  const cancel = () => {
    if (frameHandle) clock.cancelFrame(frameHandle);
    frameHandle = 0;
  };

  const step = () => {
    const elapsed = clock.now() - startTime;
    const fraction = durationMillis <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / durationMillis));
    state.value = interpolate(from, to, easing(fraction));
    if (fraction < 1) frameHandle = clock.requestFrame(step);
    else frameHandle = 0;
  };

  const start = (nextTarget) => {
    const next = Number(nextTarget) || 0;
    cancel();
    from = state.value;
    to = next;
    startTime = clock.now();
    if (durationMillis === 0 || from === to) {
      state.value = to;
      return;
    }
    frameHandle = clock.requestFrame(step);
  };

  const stopWatch = watchTarget(target, start);
  Object.defineProperty(state, "stop", {
    configurable: true,
    value() {
      cancel();
      stopWatch();
    },
  });
  return state;
}

function interpolateColor(from, to, fraction) {
  const fa = (from >>> 24) & 0xff;
  const fr = (from >>> 16) & 0xff;
  const fg = (from >>> 8) & 0xff;
  const fb = from & 0xff;
  const ta = (to >>> 24) & 0xff;
  const tr = (to >>> 16) & 0xff;
  const tg = (to >>> 8) & 0xff;
  const tb = to & 0xff;
  const channel = (a, b) => Math.round(a + (b - a) * fraction) & 0xff;
  return ((channel(fa, ta) << 24) | (channel(fr, tr) << 16) | (channel(fg, tg) << 8) | channel(fb, tb)) >>> 0;
}

export function animateFloatAsState(targetValue, args = {}) {
  return animateNumberAsState(targetValue, args);
}

export function animateDpAsState(targetValue, args = {}) {
  return animateNumberAsState(targetValue, args);
}

export function animateColorAsState(targetValue, args = {}) {
  return animateNumberAsState(targetValue, args, interpolateColor);
}

export function updateTransition(targetState, args = {}) {
  return {
    targetState,
    animateFloat(label, targetForState, animationArgs = {}) {
      const target = () => targetForState(readTarget(targetState));
      return animateFloatAsState(target, { ...args, ...animationArgs });
    },
    animateDp(label, targetForState, animationArgs = {}) {
      const target = () => targetForState(readTarget(targetState));
      return animateDpAsState(target, { ...args, ...animationArgs });
    },
    animateColor(label, targetForState, animationArgs = {}) {
      const target = () => targetForState(readTarget(targetState));
      return animateColorAsState(target, { ...args, ...animationArgs });
    },
  };
}
