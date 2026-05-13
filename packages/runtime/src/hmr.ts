import type {NativeReloadPayload, NativeTransactionTarget} from "./native.ts"

export const ARRANGE_HMR_RELOAD_EVENT = "arrange:reload"

export type ArrangeHmrReloadPayload = NativeReloadPayload
type NativeReloadTarget = NativeTransactionTarget & {
    reload?: (payload: ArrangeHmrReloadPayload) => void
}

type HotLike = {
    on: (event: string, callback: (payload: ArrangeHmrReloadPayload | null | undefined) => void) => void
}

function resolveNativeTarget(target?: NativeReloadTarget | (() => NativeReloadTarget | undefined)): NativeReloadTarget | undefined {
    if (typeof target === "function") return target()
    return target ?? globalThis.__ARRANGE_NATIVE__ as NativeReloadTarget | undefined
}

export function installArrangeHmrClient(hot: HotLike | null | undefined, target?: NativeReloadTarget | (() => NativeReloadTarget | undefined)): boolean {
    if (!hot || typeof hot.on !== "function") return false

    hot.on(ARRANGE_HMR_RELOAD_EVENT, (payload: ArrangeHmrReloadPayload | null | undefined) => {
        const native = resolveNativeTarget(target)
        if (native && typeof native.reload === "function") native.reload(payload ?? {})
    })

    return true
}

