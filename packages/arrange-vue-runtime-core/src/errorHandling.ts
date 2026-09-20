import { pauseTracking, resetTracking, WatchErrorCodes } from '@arrange/vue-reactivity'
import { EMPTY_OBJ, isArray, isFunction, isPromise } from '@arrange/vue-shared'
import type { ArrangableInstance } from './arrangable.ts'
import { LifecycleHooks } from './enums.ts'
import type { VNode } from './vnode.ts'
import { popWarningContext, pushWarningContext, warn } from './warning.ts'

// contexts where user provided function may be executed, in addition to
// lifecycle hooks.
export enum ErrorCodes {
    SETUP_FUNCTION,
    RENDER_FUNCTION,
    // The error codes for the watch have been transferred to the reactivity
    // package along with baseWatch to maintain code compatibility. Hence,
    // it is essential to keep these values unchanged.
    // WATCH_GETTER,
    // WATCH_CALLBACK,
    // WATCH_CLEANUP,
    NATIVE_EVENT_HANDLER = 5,
    TRANSITION_HOOK,
    APP_ERROR_HANDLER,
    APP_WARN_HANDLER,
    ASYNC_ARRANGABLE_LOADER,
    SCHEDULER,
    ARRANGABLE_UPDATE,
    APP_UNMOUNT_CLEANUP,
}

export const ErrorTypeStrings: Record<ErrorTypes, string> = {
    [LifecycleHooks.BEFORE_CREATE]: 'beforeCreate 生命周期回调',
    [LifecycleHooks.CREATED]: 'created 生命周期回调',
    [LifecycleHooks.BEFORE_MOUNT]: 'beforeMount 生命周期回调',
    [LifecycleHooks.MOUNTED]: 'mounted 生命周期回调',
    [LifecycleHooks.BEFORE_UPDATE]: 'beforeUpdate 生命周期回调',
    [LifecycleHooks.UPDATED]: 'updated',
    [LifecycleHooks.BEFORE_UNMOUNT]: 'beforeUnmount 生命周期回调',
    [LifecycleHooks.UNMOUNTED]: 'unmounted 生命周期回调',
    [LifecycleHooks.ACTIVATED]: 'activated 生命周期回调',
    [LifecycleHooks.DEACTIVATED]: 'deactivated 生命周期回调',
    [LifecycleHooks.ERROR_CAPTURED]: 'errorCaptured 生命周期回调',
    [LifecycleHooks.RENDER_TRACKED]: 'renderTracked 生命周期回调',
    [LifecycleHooks.RENDER_TRIGGERED]: 'renderTriggered 生命周期回调',
    [ErrorCodes.SETUP_FUNCTION]: '初始化函数',
    [ErrorCodes.RENDER_FUNCTION]: '重排函数',
    [WatchErrorCodes.WATCH_GETTER]: '观察取值',
    [WatchErrorCodes.WATCH_CALLBACK]: '观察回调',
    [WatchErrorCodes.WATCH_CLEANUP]: '观察清理函数',
    [ErrorCodes.NATIVE_EVENT_HANDLER]: '原生事件回调',
    [ErrorCodes.TRANSITION_HOOK]: '过渡回调',
    [ErrorCodes.APP_ERROR_HANDLER]: '应用错误处理器',
    [ErrorCodes.APP_WARN_HANDLER]: '应用警告处理器',
    [ErrorCodes.ASYNC_ARRANGABLE_LOADER]: '异步 Arrangable 加载器',
    [ErrorCodes.SCHEDULER]: '调度执行',
    [ErrorCodes.ARRANGABLE_UPDATE]: 'Arrangable 更新',
    [ErrorCodes.APP_UNMOUNT_CLEANUP]: '应用卸载清理',
}

export type ErrorTypes = LifecycleHooks | ErrorCodes | WatchErrorCodes

export function callWithErrorHandling(
    fn: Function,
    instance: ArrangableInstance | null | undefined,
    type: ErrorTypes,
    args?: unknown[],
): any {
    try {
        return args ? fn(...args) : fn()
    } catch (err) {
        handleError(err, instance, type)
    }
}

export function callWithAsyncErrorHandling(
    fn: Function | Function[],
    instance: ArrangableInstance | null,
    type: ErrorTypes,
    args?: unknown[],
): any {
    if (isFunction(fn)) {
        const res = callWithErrorHandling(fn, instance, type, args)
        if (res && isPromise(res)) {
            res.catch(err => {
                handleError(err, instance, type)
            })
        }
        return res
    }

    if (isArray(fn)) {
        const values = []
        for (let i = 0; i < fn.length; i++) {
            values.push(callWithAsyncErrorHandling(fn[i], instance, type, args))
        }
        return values
    } else if (__DEV__) {
        warn(
            `异步错误处理入口收到无效值类型： ${typeof fn}`,
        )
    }
}

export function handleError(
    err: unknown,
    instance: ArrangableInstance | null | undefined,
    type: ErrorTypes,
    throwInDev = true,
): void {
    const contextVNode = instance ? instance.vnode : null
    const { errorHandler, throwUnhandledErrorInProduction } =
        (instance && instance.appContext.config) || EMPTY_OBJ
    if (instance) {
        let cur = instance.parent
        // the exposed instance is the render proxy to keep it consistent with 2.x
        const exposedInstance = instance.proxy
        // in production the hook receives only the error code
        const errorInfo = __DEV__
            ? ErrorTypeStrings[type]
            : `Arrange 执行错误 ${type}`
        while (cur) {
            const errorCapturedHooks = cur.ec
            if (errorCapturedHooks) {
                for (let i = 0; i < errorCapturedHooks.length; i++) {
                    if (
                        errorCapturedHooks[i](err, exposedInstance, errorInfo) === false
                    ) {
                        return
                    }
                }
            }
            cur = cur.parent
        }
        // app-level handling
        if (errorHandler) {
            pauseTracking()
            callWithErrorHandling(errorHandler, null, ErrorCodes.APP_ERROR_HANDLER, [
                err,
                exposedInstance,
                errorInfo,
            ])
            resetTracking()
            return
        }
    }
    logError(err, type, contextVNode, throwInDev, throwInDev && throwUnhandledErrorInProduction !== false)
}

function logError(
    err: unknown,
    type: ErrorTypes,
    contextVNode: VNode | null,
    throwInDev = true,
    throwInProd = true,
) {
    if (__DEV__) {
        const info = ErrorTypeStrings[type]
        if (contextVNode) {
            pushWarningContext(contextVNode)
        }
        warn(`未处理的执行错误${info ? `：${info}` : ``}`)
        if (contextVNode) {
            popWarningContext()
        }
        // crash in dev by default so it's more noticeable
        if (throwInDev) {
            throw err
        } else if (!__TEST__) {
            console.error(err)
        }
    } else if (throwInProd) {
        throw err
    } else {
        // recover in prod to reduce the impact on end-user
        console.error(err)
    }
}
