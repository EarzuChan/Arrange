import { ShapeFlags, isString } from '@arrange/vue-shared'
import type { ComponentInternalInstance } from '../component.ts'
import { isHmrUpdating } from '../hmr.ts'
import {

    MoveType,
    type RendererElement,
    type RendererInternals,
    type RendererNode,
    type RendererOptions,
    queuePostRenderEffect,
    traverseStaticChildren,
} from '../renderer.ts'
import { type SchedulerJob, SchedulerJobFlags } from '../scheduler.ts'
import type { VNode, VNodeArrayChildren, VNodeProps } from '../vnode.ts'
import { warn } from '../warning.ts'
import type { SuspenseBoundary } from './Suspense.ts'

export type TeleportVNode = VNode<RendererNode, RendererElement, TeleportProps>

export interface TeleportProps {
    to: RendererElement | null | undefined
    disabled?: boolean
    defer?: boolean
}

const pendingMounts = new WeakMap<VNode, SchedulerJob>()

export const TeleportEndKey: unique symbol = Symbol('_vte')

export const isTeleport = (type: any): boolean => type.__isTeleport

const isTeleportDisabled = (props: VNode['props']): boolean =>
    props && (props.disabled || props.disabled === '')

const isTeleportDeferred = (props: VNode['props']): boolean =>
    props && (props.defer || props.defer === '')

const resolveTarget = (props: TeleportProps | null): RendererElement | null => props?.to ?? null

export const TeleportImpl = {
    name: 'Teleport',
    __isTeleport: true,
    process(
        n1: TeleportVNode | null,
        n2: TeleportVNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentComponent: ComponentInternalInstance | null,
        parentSuspense: SuspenseBoundary | null,
        optimized: boolean,
        internals: RendererInternals,
    ): void {
        const {
            mc: mountChildren,
            pc: patchChildren,
            pbc: patchBlockChildren,
            o: { insert, createText, createComment, parentNode },
        } = internals

        const disabled = isTeleportDisabled(n2.props)
        let { dynamicChildren } = n2

        // #3302
        // HMR updated, force full diff
        if (__DEV__ && isHmrUpdating) {
            optimized = false
            dynamicChildren = null
        }

        const mount = (
            vnode: TeleportVNode,
            container: RendererElement,
            anchor: RendererNode,
        ) => {
            // Teleport *always* has Array children. This is enforced in both the
            // compiler and vnode children normalization.
            if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
                mountChildren(
                    vnode.children as VNodeArrayChildren,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    optimized,
                )
            }
        }

        const mountToTarget = (vnode: TeleportVNode = n2) => {
            const disabled = isTeleportDisabled(vnode.props)
            const target = (vnode.target = resolveTarget(vnode.props))
            const targetAnchor = prepareAnchor(target, vnode, createText, insert)
            if (target) {

                if (!disabled) {
                    mount(vnode, target, targetAnchor)
                }
            } else if (__DEV__ && !disabled) {
                warn('Invalid Teleport target on mount:', target, `(${typeof target})`)
            }
        }

        const queuePendingMount = (vnode: TeleportVNode) => {
            const mountJob: SchedulerJob = () => {
                if (pendingMounts.get(vnode) !== mountJob) return
                pendingMounts.delete(vnode)
                if (isTeleportDisabled(vnode.props)) {
                    // Use the current parent of the placeholder instead of the
                    // captured `container`, which may be stale if Suspense has moved
                    // the branch to a different container during resolve.
                    const mountContainer = parentNode(vnode.el!) || container
                    mount(vnode, mountContainer, vnode.anchor!)
                }
                mountToTarget(vnode)
            }
            pendingMounts.set(vnode, mountJob)
            queuePostRenderEffect(mountJob, parentSuspense)
        }

        if (n1 == null) {
            // insert anchors in the main view
            const placeholder = (n2.el = __DEV__
                ? createComment('teleport start')
                : createText(''))
            const mainAnchor = (n2.anchor = __DEV__
                ? createComment('teleport end')
                : createText(''))
            insert(placeholder, container, anchor)
            insert(mainAnchor, container, anchor)

            if (
                isTeleportDeferred(n2.props) ||
                ((parentSuspense) && parentSuspense.pendingBranch)
            ) {
                queuePendingMount(n2)
                return
            }

            if (disabled) {
                mount(n2, container, mainAnchor)
            }

            mountToTarget()
        } else {
            // update content
            n2.el = n1.el
            const mainAnchor = (n2.anchor = n1.anchor)!
            // Target mounting may still be pending because of deferred teleport or a
            // parent suspense buffering post-render effects. In that case, replace
            // the pending mount so the latest vnode goes through the mount flow.
            const pendingMount = pendingMounts.get(n1)
            if (pendingMount) {
                pendingMount.flags! |= SchedulerJobFlags.DISPOSED
                pendingMounts.delete(n1)
                queuePendingMount(n2)
                return
            }
            n2.targetStart = n1.targetStart
            const target = (n2.target = n1.target)!
            const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
            const wasDisabled = isTeleportDisabled(n1.props)
            const currentContainer = wasDisabled ? container : target
            const currentAnchor = wasDisabled ? mainAnchor : targetAnchor

            if (dynamicChildren) {
                // fast path when the teleport happens to be a block root
                patchBlockChildren(
                    n1.dynamicChildren!,
                    dynamicChildren,
                    currentContainer,
                    parentComponent,
                    parentSuspense,
                )
                // even in block tree mode we need to make sure all root-level nodes

                // be moved in future patches.
                // in dev mode, deep traversal is necessary for HMR
                traverseStaticChildren(n1, n2, !__DEV__)
            } else if (!optimized) {
                patchChildren(
                    n1,
                    n2,
                    currentContainer,
                    currentAnchor,
                    parentComponent,
                    parentSuspense,
                    false,
                )
            }

            if (disabled) {
                if (!wasDisabled) {
                    // enabled -> disabled
                    // move into main container
                    moveTeleport(
                        n2,
                        container,
                        mainAnchor,
                        internals,
                        TeleportMoveTypes.TOGGLE,
                    )
                } else {
                    // #7835
                    // When `teleport` is disabled, `to` may change, making it always old,
                    // to ensure the correct `to` when enabled
                    if (n2.props && n1.props && n2.props.to !== n1.props.to) {
                        n2.props.to = n1.props.to
                    }
                }
            } else {
                // target changed
                if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
                    const nextTarget = (n2.target = resolveTarget(
                        n2.props,
                    ))
                    if (nextTarget) {
                        moveTeleport(
                            n2,
                            nextTarget,
                            null,
                            internals,
                            TeleportMoveTypes.TARGET_CHANGE,
                        )
                    } else if (__DEV__) {
                        warn(
                            'Invalid Teleport target on update:',
                            target,
                            `(${typeof target})`,
                        )
                    }
                } else if (wasDisabled) {
                    // disabled -> enabled
                    // move into teleport target
                    moveTeleport(
                        n2,
                        target,
                        targetAnchor,
                        internals,
                        TeleportMoveTypes.TOGGLE,
                    )
                }
            }
        }
    },
    remove(
        vnode: VNode,
        parentComponent: ComponentInternalInstance | null,
        parentSuspense: SuspenseBoundary | null,
        { um: unmount, o: { remove: hostRemove } }: RendererInternals,
        doRemove: boolean,
    ): void {
        const {
            shapeFlag,
            children,
            anchor,
            targetStart,
            targetAnchor,
            target,
            props,
        } = vnode

        let shouldRemove = doRemove || !isTeleportDisabled(props)
        // A deferred teleport inside a pending suspense may be unmounted before its
        // content is ever mounted. Clear the queued mount effect and skip removing
        // children because nothing has been mounted yet.
        const pendingMount = pendingMounts.get(vnode)
        if (pendingMount) {
            pendingMount.flags! |= SchedulerJobFlags.DISPOSED
            pendingMounts.delete(vnode)
            shouldRemove = false
        }

        if (target) {
            hostRemove(targetStart!)
            hostRemove(targetAnchor!)
        }

        // an unmounted teleport should always unmount its children whether it's disabled or not
        doRemove && hostRemove(anchor!)
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            for (let i = 0; i < (children as VNode[]).length; i++) {
                const child = (children as VNode[])[i]
                unmount(
                    child,
                    parentComponent,
                    parentSuspense,
                    shouldRemove,
                    !!child.dynamicChildren,
                )
            }
        }
    },
    move: moveTeleport as typeof moveTeleport,
}

export enum TeleportMoveTypes {
    TARGET_CHANGE,
    TOGGLE, // enable / disable
    REORDER, // moved in the main view
}

function moveTeleport(
    vnode: VNode,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    { o: { insert }, m: move }: RendererInternals,
    moveType: TeleportMoveTypes = TeleportMoveTypes.REORDER,
): void {
    // move target anchor if this is a target change.
    if (moveType === TeleportMoveTypes.TARGET_CHANGE) {
        insert(vnode.targetAnchor!, container, parentAnchor)
    }
    const { el, anchor, shapeFlag, children, props } = vnode
    const isReorder = moveType === TeleportMoveTypes.REORDER
    // move main view anchor if this is a re-order.
    if (isReorder) {
        insert(el!, container, parentAnchor)
    }
    // if this is a re-order and teleport is enabled (content is in target)
    // do not move children. So the opposite is: only move children if this
    // is not a reorder, or the teleport is disabled
    // #14701 don't move children if in pending mount
    if (!pendingMounts.has(vnode) && (!isReorder || isTeleportDisabled(props))) {
        // Teleport has either Array children or no children.
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            for (let i = 0; i < (children as VNode[]).length; i++) {
                move(
                    (children as VNode[])[i],
                    container,
                    parentAnchor,
                    MoveType.REORDER,
                )
            }
        }
    }
    // move main view anchor if this is a re-order.
    if (isReorder) {
        insert(anchor!, container, parentAnchor)
    }
}

// Force-casted public typing for h and TSX props inference
export const Teleport = TeleportImpl as unknown as {
    __isTeleport: true
    new(): {
        $props: VNodeProps & TeleportProps
        $slots: {
            default(): VNode[]
        }
    }
}

function prepareAnchor(
    target: RendererElement | null,
    vnode: TeleportVNode,
    createText: RendererOptions['createText'],
    insert: RendererOptions['insert'],
    anchor: RendererNode | null = null,
) {
    const targetStart = (vnode.targetStart = createText(''))
    const targetAnchor = (vnode.targetAnchor = createText(''))

    // attach a special property, so we can skip teleported content in
    // renderer's nextSibling search
    targetStart[TeleportEndKey] = targetAnchor

    if (target) {
        insert(targetStart, target, anchor)
        insert(targetAnchor, target, anchor)
    }

    return targetAnchor
}
