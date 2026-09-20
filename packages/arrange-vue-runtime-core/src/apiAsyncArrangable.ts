import { onScopeDispose, ref } from '@arrange/vue-reactivity'
import { isFunction, isObject } from '@arrange/vue-shared'
import { defineArrangable } from './apiDefineArrangable.ts'
import {
    type Arrangable,
    type ArrangableInstance,
    type ArrangableOptions,
    type ConcreteArrangable,
    currentInstance
} from './arrangable.ts'
import type { ArrangablePublicInstance } from './arrangablePublicInstance.ts'
import { ErrorCodes, handleError } from './errorHandling.ts'
import { markAsyncBoundary } from './helpers/useId.ts'
import { type VNode, createVNode } from './vnode.ts'
import { scheduleFrameDeadline } from './frameDeadline.ts'
import { warn } from './warning.ts'

export type AsyncArrangableResolveResult<T = Arrangable> = T | { default: T } // es modules

export type AsyncArrangableLoader<T = any> = () => Promise<
    AsyncArrangableResolveResult<T>
>

export interface AsyncArrangableOptions<T = any> {
    loader: AsyncArrangableLoader<T>
    loadingArrangable?: Arrangable
    errorArrangable?: Arrangable
    delay?: number
    timeout?: number
    onError?: (
        error: Error,
        retry: () => void,
        fail: () => void,
        attempts: number,
    ) => any
}

export const isAsyncWrapper = (i: ArrangableInstance | VNode): boolean =>
    !!(i.type as ArrangableOptions).__asyncLoader

/*@__NO_SIDE_EFFECTS__*/
export function defineAsyncArrangable<
    T extends Arrangable = { new(): ArrangablePublicInstance },
>(source: AsyncArrangableLoader<T> | AsyncArrangableOptions<T>): T {
    if (isFunction(source)) {
        source = { loader: source }
    }

    const {
        loader,
        loadingArrangable,
        errorArrangable,
        delay = 200,
        timeout, // undefined = never times out
        onError: userOnError,
    } = source

    let pendingRequest: Promise<ConcreteArrangable> | null = null
    let resolvedComp: ConcreteArrangable | undefined

    let retries = 0
    const retry = () => {
        retries++
        pendingRequest = null
        return load()
    }

    const load = (): Promise<ConcreteArrangable> => {
        let thisRequest: Promise<ConcreteArrangable>
        return (
            pendingRequest ||
            (thisRequest = pendingRequest =
                Promise.resolve().then(loader)
                    .catch(err => {
                        err = err instanceof Error ? err : new Error(String(err))
                        if (userOnError) {
                            return new Promise((resolve, reject) => {
                                const userRetry = () => resolve(retry())
                                const userFail = () => reject(err)
                                userOnError(err, userRetry, userFail, retries + 1)
                            })
                        } else {
                            throw err
                        }
                    })
                    .then((comp: any) => {
                        if (thisRequest !== pendingRequest && pendingRequest) {
                            return pendingRequest
                        }
                        // interop module default
                        if (
                            comp &&
                            (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
                        ) {
                            comp = comp.default
                        }
                        if (!comp || (!isObject(comp) && !isFunction(comp))) {
                            throw new Error(`异步Arrangable加载结果无效：${comp}`)
                        }
                        resolvedComp = comp
                        return comp
                    }))
        )
    }

    return defineArrangable({
        name: 'AsyncArrangableWrapper',
        __asyncLoader: load,
        get __asyncResolved() {
            return resolvedComp
        },
        setup() {
            const instance = currentInstance!
            markAsyncBoundary(instance)

            // already resolved
            if (resolvedComp) {
                return () => createInnerComp(resolvedComp!, instance)
            }

            const onError = (err: Error) => {
                if (!instance.scope.active) return
                pendingRequest = null
                handleError(
                    err,
                    instance,
                    ErrorCodes.ASYNC_ARRANGABLE_LOADER,
                    !errorArrangable /* do not throw in dev if user provided error arrangable */,
                )
            }

            const loaded = ref(false)
            const error = ref()
            const delayed = ref(!!delay)

            let cancelDelay = () => { }
            let cancelTimeout = () => { }
            const cancelDeadlines = () => {
                cancelDelay()
                cancelTimeout()
            }
            onScopeDispose(cancelDeadlines)

            if (loadingArrangable && delay) {
                cancelDelay = scheduleFrameDeadline(delay, () => { delayed.value = false })
            }

            if (timeout != null) {
                cancelTimeout = scheduleFrameDeadline(timeout, () => {
                    if (!loaded.value && !error.value) {
                        cancelDeadlines()
                        const err = new Error(`异步Arrangable加载超时（${timeout}ms）`)
                        error.value = err
                        onError(err)
                    }
                })
            }

            load()
                .then(() => {
                    cancelDeadlines()
                    if (!instance.scope.active) return

                    loaded.value = true

                })
                .catch(err => {
                    cancelDeadlines()
                    if (!instance.scope.active) return

                    onError(err)
                    error.value = err
                })

            return () => {
                if (loaded.value && resolvedComp) {
                    return createInnerComp(resolvedComp, instance)
                } else if (error.value && errorArrangable) {
                    return createVNode(errorArrangable, {
                        error: error.value,
                    })
                } else if (loadingArrangable && !delayed.value) {
                    return createInnerComp(
                        loadingArrangable as ConcreteArrangable,
                        instance,
                    )
                }
            }
        },
    }) as T
}

function createInnerComp(
    comp: ConcreteArrangable,
    parent: ArrangableInstance,
) {
    const { props, children } = parent.vnode
    const vnode = createVNode(comp, props, children)

    return vnode
}
