import { ShapeFlags, isArray, isFunction, toNumber } from '@arrange/vue-shared'
import {
    type ComponentInternalInstance,
    handleSetupResult,
    unsetCurrentInstance,
} from '../component.ts'
import { filterSingleRoot, updateHOCHostEl } from '../componentRenderUtils.ts'
import type { Slots } from '../componentSlots.ts'
import { ErrorCodes, handleError } from '../errorHandling.ts'
import { NULL_DYNAMIC_COMPONENT } from '../helpers/resolveAssets.ts'
import {

    MoveType,
    type RendererElement,
    type RendererInternals,
    type RendererNode,
    type SetupRenderEffectFn,
    queuePostRenderEffect,
} from '../renderer.ts'
import { scheduleFrameDeadline } from '../frameDeadline.ts'
import { queuePostFlushCb } from '../scheduler.ts'
import {
    Comment,
    type VNode,
    type VNodeProps,
    closeBlock,
    createVNode,
    currentBlock,
    isBlockTreeEnabled,
    isSameVNodeType,
    normalizeVNode,
    openBlock,
} from '../vnode.ts'
import {
    assertNumber,
    popWarningContext,
    pushWarningContext,
    warn,
} from '../warning.ts'

export interface SuspenseProps {
    onResolve?: () => void
    onPending?: () => void
    onFallback?: () => void
    /**
     * Switch to fallback content if it takes longer than `timeout` milliseconds to render the new default content.
     * A `timeout` value of `0` will cause the fallback content to be displayed immediately when default content is replaced.
     */
    timeout?: string | number
    /**
     * Allow suspense to be captured by parent suspense
     *
     * @default false
     */
    suspensible?: boolean
}

export const isSuspense = (type: any): boolean => type.__isSuspense

// incrementing unique id for every pending branch
let suspenseId = 0

/**
 * For testing only
 */
export const resetSuspenseId = (): number => (suspenseId = 0)

// Suspense exposes a component-like API, and is treated like a component
// in the compiler, but internally it's a special built-in type that hooks
// directly into the renderer.
export const SuspenseImpl = {
    name: 'Suspense',
    // In order to make Suspense tree-shakable, we need to avoid importing it
    // directly in the renderer. The renderer checks for the __isSuspense flag
    // on a vnode's type and calls the `process` method, passing in renderer
    // internals.
    __isSuspense: true,
    process(
        n1: VNode | null,
        n2: VNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentComponent: ComponentInternalInstance | null,
        parentSuspense: SuspenseBoundary | null,
        optimized: boolean,
        // platform-specific impl passed from renderer
        rendererInternals: RendererInternals,
    ): void {
        if (n1 == null) {
            mountSuspense(
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                optimized,
                rendererInternals,
            )
        } else {
            // #8678 if the current suspense needs to be patched and parentSuspense has
            // not been resolved. this means that both the current suspense and parentSuspense
            // need to be patched. because parentSuspense's pendingBranch includes the
            // current suspense, it will be processed twice:
            //  1. current patch
            //  2. mounting along with the pendingBranch of parentSuspense
            // it is necessary to skip the current patch to avoid multiple mounts
            // of inner components.
            if (
                parentSuspense &&
                parentSuspense.deps > 0 &&
                !n1.suspense!.isInFallback
            ) {
                n2.suspense = n1.suspense!
                n2.suspense.vnode = n2
                n2.el = n1.el
                return
            }
            patchSuspense(
                n1,
                n2,
                container,
                anchor,
                parentComponent,
                optimized,
                rendererInternals,
            )
        }
    },
    normalize: normalizeSuspenseChildren as typeof normalizeSuspenseChildren,
}

// Force-casted public typing for h and TSX props inference
export const Suspense = ((SuspenseImpl)) as unknown as {
    __isSuspense: true
    new(): {
        $props: VNodeProps & SuspenseProps
        $slots: {
            default(): VNode[]
            fallback(): VNode[]
        }
    }
}

function triggerEvent(
    vnode: VNode,
    name: 'onResolve' | 'onPending' | 'onFallback',
) {
    const eventListener = vnode.props && vnode.props[name]
    if (isFunction(eventListener)) {
        eventListener()
    }
}

function mountSuspense(
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    optimized: boolean,
    rendererInternals: RendererInternals,
) {
    const {
        p: patch,
        o: { createStorageContainer },
    } = rendererInternals
    const hiddenContainer = createStorageContainer()
    const suspense = (vnode.suspense = createSuspenseBoundary(
        vnode,
        parentSuspense,
        parentComponent,
        container,
        hiddenContainer,
        anchor,
        optimized,
        rendererInternals,
    ))

    patch(
        null,
        (suspense.pendingBranch = vnode.ssContent!),
        hiddenContainer,
        null,
        parentComponent,
        suspense,
    )
    // now check if we have encountered any async deps
    if (suspense.deps > 0) {
        // has async
        // invoke @fallback event
        triggerEvent(vnode, 'onPending')
        triggerEvent(vnode, 'onFallback')

        // mount the fallback tree
        patch(
            null,
            vnode.ssFallback!,
            container,
            anchor,
            parentComponent,
            null, // fallback tree will not have suspense context

        )
        setActiveBranch(suspense, vnode.ssFallback!)
    } else {
        // Suspense has no async deps. Just resolve.
        suspense.resolve(false, true)
    }
}

function patchSuspense(
    n1: VNode,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    optimized: boolean,
    { p: patch, um: unmount, o: { createStorageContainer } }: RendererInternals,
) {
    const suspense = (n2.suspense = n1.suspense)!
    suspense.vnode = n2
    n2.el = n1.el
    const newBranch = n2.ssContent!
    const newFallback = n2.ssFallback!

    const { activeBranch, pendingBranch, isInFallback } = suspense
    if (pendingBranch) {
        suspense.pendingBranch = newBranch
        if (isSameVNodeType(pendingBranch, newBranch)) {
            // same root type but content may have changed.
            patch(
                pendingBranch,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                optimized,
            )
            if (suspense.deps <= 0) {
                suspense.resolve()
            } else if (isInFallback) {
                {
                    patch(
                        activeBranch,
                        newFallback,
                        container,
                        anchor,
                        parentComponent,
                        null, // fallback tree will not have suspense context

                        optimized,
                    )
                    setActiveBranch(suspense, newFallback)
                }
            }
        } else {
            // toggled before pending tree is resolved
            // increment pending ID. this is used to invalidate async callbacks
            suspense.pendingId = suspenseId++
            unmount(pendingBranch, parentComponent, suspense)
            suspense.cancelPendingDelay?.()
            // 重置等待分支

            suspense.deps = 0
            // discard effects from pending branch
            suspense.effects.length = 0
            // discard previous container
            suspense.hiddenContainer = createStorageContainer()

            if (isInFallback) {
                // already in fallback state
                patch(
                    null,
                    newBranch,
                    suspense.hiddenContainer,
                    null,
                    parentComponent,
                    suspense,
                    optimized,
                )
                if (suspense.deps <= 0) {
                    suspense.resolve()
                } else {
                    patch(
                        activeBranch,
                        newFallback,
                        container,
                        anchor,
                        parentComponent,
                        null, // fallback tree will not have suspense context

                        optimized,
                    )
                    setActiveBranch(suspense, newFallback)
                }
            } else if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
                // toggled "back" to current active branch
                patch(
                    activeBranch,
                    newBranch,
                    container,
                    anchor,
                    parentComponent,
                    suspense,
                    optimized,
                )
                // force resolve
                suspense.resolve(true)
            } else {
                // 等待期间替换异步分支，新的分支重新取得延迟所有权
                patch(
                    null,
                    newBranch,
                    suspense.hiddenContainer,
                    null,
                    parentComponent,
                    suspense,
                    optimized,
                )
                if (suspense.deps <= 0) {
                    suspense.resolve()
                } else {
                    scheduleFallback(suspense)
                }
            }
        }
    } else {
        if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
            // root did not change, just normal patch
            patch(
                activeBranch,
                newBranch,
                container,
                anchor,
                parentComponent,
                suspense,
                optimized,
            )
            setActiveBranch(suspense, newBranch)
        } else {
            // root node toggled
            // invoke @pending event
            triggerEvent(n2, 'onPending')

            suspense.pendingBranch = newBranch
            if (newBranch.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
                suspense.pendingId = newBranch.component!.suspenseId!
            } else {
                suspense.pendingId = suspenseId++
            }
            patch(
                null,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                optimized,
            )
            if (suspense.deps <= 0) {
                // incoming branch has no async deps, resolve now.
                suspense.resolve()
            } else {
                scheduleFallback(suspense)
            }
        }
    }
}

function scheduleFallback(suspense: SuspenseBoundary) {
    const { timeout, pendingId } = suspense
    suspense.cancelPendingDelay?.()

    if (timeout > 0) {
        suspense.cancelPendingDelay = scheduleFrameDeadline(timeout, () => {
            if (!suspense.isUnmounted && suspense.pendingId === pendingId) suspense.fallback(suspense.vnode.ssFallback!)
        })
    } else if (timeout === 0) {
        suspense.fallback(suspense.vnode.ssFallback!)
    }
}

export interface SuspenseBoundary {
    vnode: VNode<RendererNode, RendererElement, SuspenseProps>
    parent: SuspenseBoundary | null
    parentComponent: ComponentInternalInstance | null

    container: RendererElement
    hiddenContainer: RendererElement
    activeBranch: VNode | null
    isFallbackMountPending: boolean
    pendingBranch: VNode | null
    deps: number
    pendingId: number
    timeout: number
    isInFallback: boolean
    cancelPendingDelay?: () => void
    isUnmounted: boolean
    effects: Function[]
    resolve(force?: boolean, sync?: boolean): void
    fallback(fallbackVNode: VNode): void
    move(
        container: RendererElement,
        anchor: RendererNode | null,
        type: MoveType,
    ): void
    next(): RendererNode | null
    registerDep(
        instance: ComponentInternalInstance,
        setupRenderEffect: SetupRenderEffectFn,
        optimized: boolean,
    ): void
    unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}

function createSuspenseBoundary(
    vnode: VNode,
    parentSuspense: SuspenseBoundary | null,
    parentComponent: ComponentInternalInstance | null,
    container: RendererElement,
    hiddenContainer: RendererElement,
    anchor: RendererNode | null,
    optimized: boolean,
    rendererInternals: RendererInternals,
): SuspenseBoundary {

    const {
        p: patch,
        m: move,
        um: unmount,
        n: next,
        o: { parentNode, remove },
    } = rendererInternals

    // if set `suspensible: true`, set the current suspense as a dep of parent suspense
    let parentSuspenseId: number | undefined
    const isSuspensible = isVNodeSuspensible(vnode)
    if (isSuspensible) {
        if (parentSuspense && parentSuspense.pendingBranch) {
            parentSuspenseId = parentSuspense.pendingId
            parentSuspense.deps++
        }
    }

    const timeout = vnode.props ? toNumber(vnode.props.timeout) : undefined
    if (__DEV__) {
        assertNumber(timeout, `Suspense timeout`)
    }

    const initialAnchor = anchor
    const suspense: SuspenseBoundary = {
        vnode,
        parent: parentSuspense,
        parentComponent,
        container,
        hiddenContainer,
        deps: 0,
        pendingId: suspenseId++,
        timeout: typeof timeout === 'number' ? timeout : -1,
        activeBranch: null,
        isFallbackMountPending: false,
        pendingBranch: null,
        isInFallback: true,
        isUnmounted: false,
        effects: [],
        resolve(resume = false, sync = false) {
            suspense.cancelPendingDelay?.()
            if (__DEV__) {
                if (!resume && !suspense.pendingBranch) {
                    throw new Error(
                        `suspense.resolve() is called without a pending branch.`,
                    )
                }
                if (suspense.isUnmounted) {
                    throw new Error(
                        `suspense.resolve() is called on an already unmounted suspense boundary.`,
                    )
                }
            }
            const {
                vnode,
                activeBranch,
                pendingBranch,
                pendingId,
                effects,
                parentComponent,
                container,
                isInFallback,
            } = suspense

            // if there's a transition happening we need to wait it to finish.
            let delayEnter: boolean | null = false
            if (!resume) {
                delayEnter =
                    activeBranch &&
                    pendingBranch!.transition &&
                    pendingBranch!.transition.mode === 'out-in'
                let hasUpdatedAnchor = false
                if (delayEnter) {
                    activeBranch!.transition!.afterLeave = () => {
                        if (pendingId === suspense.pendingId) {
                            move(
                                pendingBranch!,
                                container,
                                anchor === initialAnchor && !hasUpdatedAnchor
                                    ? next(activeBranch!)
                                    : anchor,
                                MoveType.ENTER,
                            )
                            queuePostFlushCb(effects)
                            // clear el reference from fallback vnode to allow GC after transition
                            if (isInFallback && vnode.ssFallback) {
                                vnode.ssFallback.el = null
                            }
                        }
                    }
                }
                // unmount current active tree
                // #7966 when Suspense is wrapped in Transition, fallback may wait for
                // afterLeave before mounting. In that window, activeBranch is still the
                // leaving content, so avoid unmounting it again during resolve.
                if (activeBranch && !suspense.isFallbackMountPending) {
                    // if the fallback tree was mounted, it may have been moved
                    // as part of a parent suspense. get the latest anchor for insertion
                    // #8105 if `delayEnter` is true, it means that the mounting of
                    // `activeBranch` will be delayed. if the branch switches before
                    // transition completes, both `activeBranch` and `pendingBranch` may
                    // coexist in the `hiddenContainer`. This could result in
                    // `next(activeBranch!)` obtaining an incorrect anchor
                    // (got `pendingBranch.el`).
                    // Therefore, after the mounting of activeBranch is completed,
                    // it is necessary to get the latest anchor.
                    if (parentNode(activeBranch.el!) === container) {
                        anchor = next(activeBranch)
                        hasUpdatedAnchor = true
                    }
                    unmount(activeBranch, parentComponent, suspense, true)
                    // clear el reference from fallback vnode to allow GC
                    if (!delayEnter && isInFallback && vnode.ssFallback) {
                        queuePostRenderEffect(() => (vnode.ssFallback!.el = null), suspense)
                    }
                }
                if (!delayEnter) {

                    move(pendingBranch!, container, anchor, MoveType.ENTER)
                }
            }

            suspense.isFallbackMountPending = false
            setActiveBranch(suspense, pendingBranch!)
            suspense.pendingBranch = null
            suspense.isInFallback = false

            // flush buffered effects
            // check if there is a pending parent suspense
            let parent = suspense.parent
            let hasUnresolvedAncestor = false
            while (parent) {
                if (parent.pendingBranch) {
                    // found a pending parent suspense, merge buffered post jobs
                    // into that parent
                    parent.effects.push(...effects)
                    hasUnresolvedAncestor = true
                    break
                }
                parent = parent.parent
            }
            // no pending parent suspense nor transition, flush all jobs
            if (!hasUnresolvedAncestor && !delayEnter) {
                queuePostFlushCb(effects)
            }
            suspense.effects = []

            // resolve parent suspense if all async deps are resolved
            if (isSuspensible) {
                if (
                    parentSuspense &&
                    parentSuspense.pendingBranch &&
                    parentSuspenseId === parentSuspense.pendingId
                ) {
                    parentSuspense.deps--
                    if (parentSuspense.deps === 0 && !sync) {
                        parentSuspense.resolve()
                    }
                }
            }

            // invoke @resolve event
            triggerEvent(vnode, 'onResolve')
        },
        fallback(fallbackVNode) {
            if (!suspense.pendingBranch) {
                return
            }

            const { vnode, activeBranch, parentComponent, container } =
                suspense

            // invoke @fallback event
            triggerEvent(vnode, 'onFallback')

            const anchor = next(activeBranch!)
            const mountFallback = () => {
                suspense.isFallbackMountPending = false
                if (!suspense.isInFallback) {
                    return
                }
                // mount the fallback tree
                patch(
                    null,
                    fallbackVNode,
                    container,
                    anchor,
                    parentComponent,
                    null, // fallback tree will not have suspense context

                    optimized,
                )
                setActiveBranch(suspense, fallbackVNode)
            }

            const delayEnter =
                fallbackVNode.transition && fallbackVNode.transition.mode === 'out-in'
            if (delayEnter) {
                suspense.isFallbackMountPending = true
                activeBranch!.transition!.afterLeave = mountFallback
            }
            suspense.isInFallback = true

            // unmount current active branch
            unmount(
                activeBranch!,
                parentComponent,
                null, // no suspense so unmount hooks fire now
                true, // shouldRemove
            )

            if (!delayEnter) {
                mountFallback()
            }
        },
        move(container, anchor, type) {
            suspense.activeBranch &&
                move(suspense.activeBranch, container, anchor, type)
            suspense.container = container
        },
        next() {
            return suspense.activeBranch && next(suspense.activeBranch)
        },
        registerDep(instance, setupRenderEffect, optimized) {
            const isInPendingSuspense = !!suspense.pendingBranch
            if (isInPendingSuspense) {
                suspense.deps++
            }
            instance
                .asyncDep!.catch(err => {
                    if (!instance.scope.active || suspense.isUnmounted || suspense.pendingId !== instance.suspenseId) return

                    handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
                })
                .then(asyncSetupResult => {
                    // retry when the setup() promise resolves.
                    // component may have been unmounted before resolve.
                    if (
                        !instance.scope.active ||
                        suspense.isUnmounted ||
                        suspense.pendingId !== instance.suspenseId
                    ) {
                        return
                    }
                    // withAsyncContext defers cleanup to a later microtask, so currentInstance may
                    // still be set when Suspense re-enters another component's render path.
                    // Clear it first.
                    unsetCurrentInstance()
                    // retry from this component
                    instance.asyncResolved = true
                    const { vnode } = instance
                    if (__DEV__) {
                        pushWarningContext(vnode)
                    }
                    handleSetupResult(instance, asyncSetupResult)
                    const placeholder = instance.subTree.el
                    setupRenderEffect(
                        instance,
                        vnode,
                        parentNode(instance.subTree.el!)!,
                        next(instance.subTree),
                        suspense,
                        optimized,
                    )
                    if (placeholder) {
                        // clean up placeholder reference
                        vnode.placeholder = null
                        remove(placeholder)
                    }
                    updateHOCHostEl(instance, vnode.el)
                    if (__DEV__) {
                        popWarningContext()
                    }
                    // only decrease deps count if suspense is not already resolved
                    if (isInPendingSuspense && --suspense.deps === 0) {
                        suspense.resolve()
                    }
                })
        },
        unmount(parentSuspense, doRemove) {
            suspense.cancelPendingDelay?.()
            suspense.isUnmounted = true
            if (suspense.activeBranch) {
                unmount(
                    suspense.activeBranch,
                    parentComponent,
                    parentSuspense,
                    doRemove,
                )
            }
            if (suspense.pendingBranch) {
                unmount(
                    suspense.pendingBranch,
                    parentComponent,
                    parentSuspense,
                    doRemove,
                )
            }
        },
    }

    return suspense
}

function normalizeSuspenseChildren(vnode: VNode): void {
    const { shapeFlag, children } = vnode
    const isSlotChildren = shapeFlag & ShapeFlags.SLOTS_CHILDREN
    vnode.ssContent = normalizeSuspenseSlot(
        isSlotChildren ? (children as Slots).default : children,
    )
    vnode.ssFallback = isSlotChildren
        ? normalizeSuspenseSlot((children as Slots).fallback)
        : createVNode(Comment)
}

function normalizeSuspenseSlot(s: any) {
    let block: VNode[] | null | undefined
    if (isFunction(s)) {
        const trackBlock = isBlockTreeEnabled && s._c
        if (trackBlock) {
            // disableTracking: false
            // allow block tracking for compiled slots
            // (see ./componentRenderContext.ts)
            s._d = false
            openBlock()
        }
        s = s()
        if (trackBlock) {
            s._d = true
            block = currentBlock
            closeBlock()
        }
    }
    if (isArray(s)) {
        const singleChild = filterSingleRoot(s)
        if (
            __DEV__ &&
            !singleChild &&
            s.filter(child => child !== NULL_DYNAMIC_COMPONENT).length > 0
        ) {
            warn(`<Suspense> slots expect a single root node.`)
        }
        s = singleChild
    }
    s = normalizeVNode(s)
    if (block && !s.dynamicChildren) {
        s.dynamicChildren = block.filter(c => c !== s)
    }
    return s
}

export function queueEffectWithSuspense(
    fn: Function | Function[],
    suspense: SuspenseBoundary | null,
): void {
    if (suspense && suspense.pendingBranch) {
        if (isArray(fn)) {
            suspense.effects.push(...fn)
        } else {
            suspense.effects.push(fn)
        }
    } else {
        queuePostFlushCb(fn)
    }
}

function setActiveBranch(suspense: SuspenseBoundary, branch: VNode) {
    suspense.activeBranch = branch
    const { vnode, parentComponent } = suspense
    let el = branch.el
    // if branch has no el after patch, it's a HOC wrapping async components
    // drill and locate the placeholder comment node
    while (!el && branch.component) {
        branch = branch.component.subTree
        el = branch.el
    }
    vnode.el = el
    // in case suspense is the root node of a component,
    // recursively update the HOC el
    if (parentComponent && parentComponent.subTree === vnode) {
        parentComponent.vnode.el = el
        updateHOCHostEl(parentComponent, el)
    }
}

function isVNodeSuspensible(vnode: VNode) {
    const suspensible = vnode.props && vnode.props.suspensible
    return suspensible != null && suspensible !== false
}
