export const ARRANGE_HMR_RELOAD_EVENT = "arrange:reload";

function resolveNativeTarget(target) {
  if (typeof target === "function") return target();
  return target ?? globalThis.__ARRANGE_NATIVE__;
}

export function installArrangeHmrClient(hot, target) {
  if (!hot || typeof hot.on !== "function") return false;

  hot.on(ARRANGE_HMR_RELOAD_EVENT, (payload) => {
    const native = resolveNativeTarget(target);
    if (native && typeof native.reload === "function") native.reload(payload ?? {});
  });

  return true;
}
