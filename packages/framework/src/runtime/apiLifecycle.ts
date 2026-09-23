import { currentInstance, setCurrentInstance, type ArrangableInstance } from './arrangable.ts'
import { pauseTracking, resetTracking, type DebuggerEvent } from '@arrange/reactivity'
import { LifecycleHooks } from './enums.ts'
import { callWithAsyncErrorHandling } from './errorHandling.ts'

export function injectHook(type: LifecycleHooks, hook: Function, target: ArrangableInstance | null = currentInstance): void {
    if (!target || target.isUnmounted) throw new Error('生命周期钩子必须在存活 Arrangable 的 setup 中注册')

    let hooks = target.hooks.get(type)

    if (!hooks) target.hooks.set(type, hooks = [])

    hooks.push((...args: unknown[]) => {
        pauseTracking()
        const restore = setCurrentInstance(target)
        try { return callWithAsyncErrorHandling(hook, target, type, args) } finally {
            restore()
            resetTracking()
        }
    })
}

const hook = (type: LifecycleHooks) => (callback: () => void): void => injectHook(type, callback)
export const onBeforeMount = hook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted = hook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate = hook(LifecycleHooks.BEFORE_UPDATE)
export const onUpdated = hook(LifecycleHooks.UPDATED)
export const onBeforeUnmount = hook(LifecycleHooks.BEFORE_UNMOUNT)
export const onUnmounted = hook(LifecycleHooks.UNMOUNTED)
export const onActivated = hook(LifecycleHooks.ACTIVATED)
export const onDeactivated = hook(LifecycleHooks.DEACTIVATED)
export const onRenderTracked = (callback: (event: DebuggerEvent) => void): void => injectHook(LifecycleHooks.RENDER_TRACKED, callback)
export const onRenderTriggered = (callback: (event: DebuggerEvent) => void): void => injectHook(LifecycleHooks.RENDER_TRIGGERED, callback)
export const onErrorCaptured = (callback: (error: unknown, source: string | undefined, phase: string) => boolean | void): void => injectHook(LifecycleHooks.ERROR_CAPTURED, callback)