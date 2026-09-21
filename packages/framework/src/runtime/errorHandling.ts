import { pauseTracking, resetTracking } from '@arrange/reactivity'
import { isPromise } from '@arrange/shared'
import type { ArrangableInstance } from './arrangable.ts'
import { LifecycleHooks } from './enums.ts'

export enum ErrorCodes {
    SETUP_FUNCTION,
    STRUCTURE_FUNCTION,
    NATIVE_EVENT_HANDLER = 5,
    TRANSITION_HOOK,
    APP_ERROR_HANDLER,
    APP_WARN_HANDLER,
    ASYNC_ARRANGABLE_LOADER,
    SCHEDULER,
    ARRANGABLE_UPDATE,
    APP_UNMOUNT_CLEANUP,
}

export type ErrorTypes = ErrorCodes | LifecycleHooks | number

export function callWithErrorHandling<T>(fn: (...args: any[]) => T, instance: ArrangableInstance | null | undefined, type: ErrorTypes, args: unknown[] = []): T | undefined {
    try { return fn(...args) } catch (error) { handleError(error, instance, type) }
}

export function callWithAsyncErrorHandling(fn: Function | Function[], instance: ArrangableInstance | null | undefined, type: ErrorTypes, args: unknown[] = []): any {
    if (Array.isArray(fn)) return fn.map(callback => callWithAsyncErrorHandling(callback, instance, type, args))
    const result = callWithErrorHandling((...values) => fn(...values), instance, type, args)
    if (isPromise(result)) result.catch((error: unknown) => handleError(error, instance, type))
    return result
}

export function handleError(error: unknown, instance: ArrangableInstance | null | undefined, type: ErrorTypes): void {
    pauseTracking()
    try {
        for (let parent = instance?.parent; parent; parent = parent.parent) {
            for (const hook of parent.hooks.get(LifecycleHooks.ERROR_CAPTURED) ?? []) if (hook(error, instance?.source, String(type)) === false) return
        }
        if (instance?.appContext.config.errorHandler) {
            instance.appContext.config.errorHandler(error, instance.source, String(type))
            return
        }
        throw error
    } finally {
        resetTracking()
    }
}
