import {
    type DebuggerEvent,
    pauseTracking,
    resetTracking,
} from '@arrange/vue-reactivity'
import {
    type ArrangableInstance,
    currentInstance,
    setCurrentInstance,
} from './arrangable.ts'
import type { ArrangablePublicInstance } from './arrangablePublicInstance.ts'
import { LifecycleHooks } from './enums.ts'
import { ErrorTypeStrings, callWithAsyncErrorHandling } from './errorHandling.ts'
import { warn } from './warning.ts'

export const onActivated = (hook: Function, target?: ArrangableInstance | null): void => { injectHook(LifecycleHooks.ACTIVATED, hook, target) }
export const onDeactivated = (hook: Function, target?: ArrangableInstance | null): void => { injectHook(LifecycleHooks.DEACTIVATED, hook, target) }

export function injectHook(
    type: LifecycleHooks,
    hook: Function & { __weh?: Function },
    target: ArrangableInstance | null = currentInstance,
    prepend: boolean = false,
): Function | undefined {
    if (target) {
        const hooks = target[type] || (target[type] = [])
        // cache the error handling wrapper for injected hooks so the same hook
        // can be properly deduped by the scheduler. "__weh" stands for "with error
        // handling".
        const wrappedHook =
            hook.__weh ||
            (hook.__weh = (...args: unknown[]) => {
                // disable tracking inside all lifecycle hooks
                // since they can potentially be called inside effects.
                pauseTracking()
                // Set currentInstance during hook invocation.
                // This assumes the hook does not synchronously trigger other hooks, which
                // can only be false when the user does something really funky.
                const reset = setCurrentInstance(target)
                const res = callWithAsyncErrorHandling(hook, target, type, args)
                reset()
                resetTracking()
                return res
            })
        if (prepend) {
            hooks.unshift(wrappedHook)
        } else {
            hooks.push(wrappedHook)
        }
        return wrappedHook
    } else if (__DEV__) {
        warn('生命周期钩子必须在活动 Arrangable 的 setup 中注册；异步 setup 须在首次 await 前注册')
    }
}

const createHook =
    <T extends Function = () => any>(lifecycle: LifecycleHooks) =>
        (
            hook: T,
            target: ArrangableInstance | null = currentInstance,
        ): void => {
            injectHook(lifecycle, (...args: unknown[]) => hook(...args), target)
        }
type CreateHook<T = any> = (
    hook: T,
    target?: ArrangableInstance | null,
) => void

export const onBeforeMount: CreateHook = createHook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted: CreateHook = createHook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate: CreateHook = createHook(
    LifecycleHooks.BEFORE_UPDATE,
)
export const onUpdated: CreateHook = createHook(LifecycleHooks.UPDATED)
export const onBeforeUnmount: CreateHook = createHook(
    LifecycleHooks.BEFORE_UNMOUNT,
)
export const onUnmounted: CreateHook = createHook(LifecycleHooks.UNMOUNTED)

export type DebuggerHook = (e: DebuggerEvent) => void
export const onRenderTriggered: CreateHook<DebuggerHook> =
    createHook<DebuggerHook>(LifecycleHooks.RENDER_TRIGGERED)
export const onRenderTracked: CreateHook<DebuggerHook> =
    createHook<DebuggerHook>(LifecycleHooks.RENDER_TRACKED)

export type ErrorCapturedHook<TError = unknown> = (
    err: TError,
    instance: ArrangablePublicInstance | null,
    info: string,
) => boolean | void

export function onErrorCaptured<TError = Error>(
    hook: ErrorCapturedHook<TError>,
    target: ArrangableInstance | null = currentInstance,
): void {
    injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
