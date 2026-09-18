import { onScopeDispose, ref } from '@arrange/vue-reactivity'
import { isFunction, isObject } from '@arrange/vue-shared'
import { defineComponent } from './apiDefineComponent.ts'
import {
    type Component,
    type ComponentInternalInstance,
    type ComponentOptions,
    type ConcreteComponent,
    currentInstance
} from './component.ts'
import type { ComponentPublicInstance } from './componentPublicInstance.ts'
import { isKeepAlive } from './components/KeepAlive.ts'
import { ErrorCodes, handleError } from './errorHandling.ts'
import { markAsyncBoundary } from './helpers/useId.ts'
import { type VNode, createVNode } from './vnode.ts'
import { scheduleFrameDeadline } from './frameDeadline.ts'
import { warn } from './warning.ts'

export type AsyncComponentResolveResult<T = Component> = T | { default: T } // es modules

export type AsyncComponentLoader<T = any> = () => Promise<
    AsyncComponentResolveResult<T>
>

export interface AsyncComponentOptions<T = any> {
    loader: AsyncComponentLoader<T>
    loadingComponent?: Component
    errorComponent?: Component
    delay?: number
    timeout?: number
    suspensible?: boolean
    onError?: (
        error: Error,
        retry: () => void,
        fail: () => void,
        attempts: number,
    ) => any
}

export const isAsyncWrapper = (i: ComponentInternalInstance | VNode): boolean =>
    !!(i.type as ComponentOptions).__asyncLoader

/*@__NO_SIDE_EFFECTS__*/
export function defineAsyncComponent<
    T extends Component = { new(): ComponentPublicInstance },
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
    if (isFunction(source)) {
        source = { loader: source }
    }

    const {
        loader,
        loadingComponent,
        errorComponent,
        delay = 200,
        timeout, // undefined = never times out
        suspensible = true,
        onError: userOnError,
    } = source

    let pendingRequest: Promise<ConcreteComponent> | null = null
    let resolvedComp: ConcreteComponent | undefined

    let retries = 0
    const retry = () => {
        retries++
        pendingRequest = null
        return load()
    }

    const load = (): Promise<ConcreteComponent> => {
        let thisRequest: Promise<ConcreteComponent>
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
                            throw new Error(`异步组件加载结果无效：${comp}`)
                        }
                        resolvedComp = comp
                        return comp
                    }))
        )
    }

    return defineComponent({
        name: 'AsyncComponentWrapper',
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
                    ErrorCodes.ASYNC_COMPONENT_LOADER,
                    !errorComponent /* do not throw in dev if user provided error component */,
                )
            }

            if (
                (((suspensible) && instance.suspense))
            ) {
                return load()
                    .then(comp => {
                        return () => createInnerComp(comp, instance)
                    })
                    .catch(err => {
                        onError(err)
                        return () =>
                            errorComponent
                                ? createVNode(errorComponent as ConcreteComponent, {
                                    error: err,
                                })
                                : null
                    })
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

            if (loadingComponent && delay) {
                cancelDelay = scheduleFrameDeadline(delay, () => { delayed.value = false })
            }

            if (timeout != null) {
                cancelTimeout = scheduleFrameDeadline(timeout, () => {
                    if (!loaded.value && !error.value) {
                        cancelDeadlines()
                        const err = new Error(`异步组件加载超时（${timeout}ms）`)
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
                    if (instance.parent && isKeepAlive(instance.parent.vnode)) {
                        // parent is keep-alive, force update so the loaded component's
                        // name is taken into account
                        instance.parent.update()
                    }
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
                } else if (error.value && errorComponent) {
                    return createVNode(errorComponent, {
                        error: error.value,
                    })
                } else if (loadingComponent && !delayed.value) {
                    return createInnerComp(
                        loadingComponent as ConcreteComponent,
                        instance,
                    )
                }
            }
        },
    }) as T
}

function createInnerComp(
    comp: ConcreteComponent,
    parent: ComponentInternalInstance,
) {
    const { ref, props, children } = parent.vnode
    const vnode = createVNode(comp, props, children)
    // ensure inner component inherits the async wrapper's ref owner
    vnode.ref = ref

    return vnode
}
