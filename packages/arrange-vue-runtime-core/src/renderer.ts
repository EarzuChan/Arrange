import {
    EffectFlags,
    computed,
    type ComputedRef,
    effectScope,
    getCurrentScope,
    ReactiveEffect,
    pauseTracking,
    resetTracking,
} from '@arrange/vue-reactivity'
import {
    EMPTY_ARR,
    EMPTY_OBJ,
    PatchFlags,
    ShapeFlags,
    def,
    getGlobalThis,
    invokeArrayFns,
    isArray,
    isReservedProp,
} from '@arrange/vue-shared'
import { type CreateAppFunction, createAppAPI } from './apiCreateApp.ts'
import {
    type ArrangableInstance,
    type Data,
    type LifecycleHook,
    createArrangableInstance,
    setupArrangable
} from './arrangable.ts'
import type { ContentScope } from './contentScope.ts'
import { updateProps } from './arrangableProps.ts'
import {
    renderArrangableRoot,
    shouldUpdateArrangable,
    updateHOCHostEl,
} from './arrangableRenderUtils.ts'
import { updateSlots } from './arrangableSlots.ts'

import {
    isHmrUpdating,
    registerHMR,
    setHmrUpdating,
    unregisterHMR,
} from './hmr.ts'

import {
    type SchedulerJob,
    SchedulerJobFlags,
    flushPostFlushCbs,
    flushPreFlushCbs,
    queueJob,
    queuePostFlushCb
} from './scheduler.ts'
import { ValueBinding, type ValueExpression, arrangeValue, isValueExpression } from './valueBinding.ts'
import { assignParameter, copyParameters } from './propDeclarations.ts'
import {
    Comment,
    Content,
    Fragment,
    LayoutInvocation,
    type VNode,
    isVNode,
    type VNodeArrayChildren,
    cloneIfMounted,
    createVNode,
    isSameVNodeType,
    normalizeVNode,
} from './vnode.ts'
import { popWarningContext, pushWarningContext, warn } from './warning.ts'

export interface Renderer<HostElement = RendererElement> {
    render: RootRenderFunction<HostElement>
    createApp: CreateAppFunction<HostElement>
}

export type RootRenderFunction<HostElement = RendererElement> = (
    vnode: VNode | null,
    container: HostElement,
) => void

export interface RendererOptions<
    HostNode = RendererNode,
    HostElement = RendererElement,
> {
    patchProp(
        el: HostElement,
        key: string,
        prevValue: any,
        nextValue: any,
        parentArrangable?: ArrangableInstance | null,
        source?: string,
    ): void
    insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
    remove(el: HostNode): void
    createLayout(): HostElement
    createComment(text: string): HostNode
    parentNode(node: HostNode): HostElement | null
    nextSibling(node: HostNode): HostNode | null
    cloneNode?(node: HostNode): HostNode

}

// Renderer Node can technically be any object in the context of core renderer
// logic - they are never directly operated on and always passed to the node op
// functions provided via options, so the internal constraint is really just
// a generic object.
export interface RendererNode {
    [key: string | symbol]: any
}

export interface RendererElement extends RendererNode { }

// These functions are created inside a closure and therefore their types cannot
// be directly exported. In order to avoid maintaining function signatures in
// two places, we declare them once here and use them inside the closure.
type PatchFn = (
    n1: VNode | null, // null means this is a mount
    n2: VNode,
    container: RendererElement,
    anchor?: RendererNode | null,
    parentArrangable?: ArrangableInstance | null,
    optimized?: boolean,
) => void

type MountChildrenFn = (
    children: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentArrangable: ArrangableInstance | null,
    optimized: boolean,
    start?: number,
) => void

type PatchChildrenFn = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentArrangable: ArrangableInstance | null,
    optimized: boolean,
) => void

type PatchBlockChildrenFn = (
    oldChildren: VNode[],
    newChildren: VNode[],
    fallbackContainer: RendererElement,
    parentArrangable: ArrangableInstance | null,
) => void

type MoveFn = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
) => void

type NextFn = (vnode: VNode) => RendererNode | null

type UnmountFn = (
    vnode: VNode,
    parentArrangable: ArrangableInstance | null,
    doRemove?: boolean,
    optimized?: boolean,
) => void

type RemoveFn = (vnode: VNode) => void

type UnmountChildrenFn = (
    children: VNode[],
    parentArrangable: ArrangableInstance | null,
    doRemove?: boolean,
    optimized?: boolean,
    start?: number,
) => void

export type MountArrangableFn = (
    initialVNode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentArrangable: ArrangableInstance | null,
    optimized: boolean,
) => void

type ProcessAnchorFn = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
) => void

export type SetupRenderEffectFn = (
    instance: ArrangableInstance,
    initialVNode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    optimized: boolean,
) => void

export const queuePostRenderEffect = queuePostFlushCb

export function createRenderer<
    HostNode = RendererNode,
    HostElement = RendererElement,
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement> {
    return baseCreateRenderer(options)
}

function baseCreateRenderer(options: RendererOptions<any, any>): any {
    // compile-time feature flags check

    const {
        insert: hostInsert,
        remove: hostRemove,
        patchProp: hostPatchProp,
        createLayout: hostCreateLayout,
        createComment: hostCreateComment,
        parentNode: hostParentNode,
        nextSibling: hostNextSibling,
    } = options

    const valueBindings = new WeakMap<VNode, Map<string | symbol, ValueBinding>>()
    const parameterReaders = new WeakMap<VNode, Map<string, { expression: ValueExpression; value: ComputedRef<unknown> }>>()
    const parameterGroup = Symbol('参数组')
    let mounting: { work: (() => void)[]; rollback: (() => void)[]; notifications: (() => void)[] } | undefined

    const afterMount = (notify: () => void) => {
        if (mounting) mounting.notifications.push(notify)
        else notify()
    }

    const insertMountedNode = (node: RendererNode, container: RendererElement, anchor: RendererNode | null) => {
        mounting?.rollback.push(() => hostRemove(node))
        hostInsert(node, container, anchor)
    }

    const afterSubtree = (execute: () => void, complete: () => void) => {
        if (mounting) mounting.work.push(complete)
        execute()
        if (!mounting) complete()
    }

    // 首次挂载按深度优先任务执行，结构深度不再累加 QuickJS 与宿主调用栈
    const patch: PatchFn = (...args) => {

        if (args[0] && isSameVNodeType(args[0], args[1])) { patchNow(...args); return }

        const scope = getCurrentScope()
        const execute = () => scope ? scope.run(() => patchNow(...args)) : patchNow(...args)
        if (mounting) { mounting.work.push(execute); return }

        const tasks = mounting = { work: [] as (() => void)[], rollback: [] as (() => void)[], notifications: [] as (() => void)[] }
        try {
            execute()
            while (tasks.work.length) tasks.work.pop()!()
            for (const notify of tasks.notifications) notify()
        } catch (error) {
            for (const retire of tasks.rollback.reverse()) retire()
            throw error
        } finally {
            mounting = undefined
        }
    }

    const prepareValueBindings = (previous: VNode | null, vnode: VNode, owner: ArrangableInstance | null) => {
        const retained = previous ? valueBindings.get(previous) : undefined
        const next = new Map<string | symbol, ValueBinding>()
        const sources = { ...vnode.valueSources }
        const raw = vnode.props
        if (raw) {
            vnode.props = copyParameters(raw)
            for (const key of Object.keys(raw)) {
                if (isValueExpression(raw[key])) sources[key] = raw[key]
            }
        }
        vnode.valueSources = Object.keys(sources).length ? sources : null
        if (vnode.shapeFlag & ShapeFlags.ARRANGABLE && Object.keys(sources).length) {
            const previousReaders = previous ? parameterReaders.get(previous) : undefined
            const readers = new Map<string, { expression: ValueExpression; value: ComputedRef<unknown> }>()
            for (const [name, expression] of Object.entries(sources)) {
                const previousReader = previousReaders?.get(name)
                const value = previousReader?.expression.read === expression.read ? previousReader.value : computed(() => {
                    try { return expression.read() } catch (error) {
                        if (error instanceof Error && expression.source && !error.message.includes(expression.source)) error.message += `\n来源：${expression.source}`
                        throw error
                    }
                })
                readers.set(name, { expression, value })
            }

            // 单个表达式独立缓存；完整参数组先求值和校验，再一次性交给实例
            const expression = arrangeValue(() => {
                const parameters = copyParameters(raw ?? {})
                for (const [name, reader] of readers) assignParameter(parameters, name, reader.value.value)
                return parameters
            }, Object.values(sources).map(source => source.source).filter(Boolean).join('\n'))
            const write = (value: unknown) => {
                const parameters = value as Data
                if (vnode.arrangable) updateProps(vnode.arrangable, parameters, vnode.props, false)
                vnode.props = parameters
            }
            let binding = retained?.get(parameterGroup)
            if (binding) binding.refresh(expression, write)
            else {
                binding = new ValueBinding(expression, owner, write)
                const created = binding
                mounting?.rollback.push(() => created.stop())
            }
            retained?.forEach((old, key) => { if (key !== parameterGroup) old.stop() })
            if (previous) {
                valueBindings.delete(previous)
                parameterReaders.delete(previous)
            }
            parameterReaders.set(vnode, readers)
            next.set(parameterGroup, binding)
            valueBindings.set(vnode, next)
            return
        }
        const expressions: [string | symbol, ValueExpression][] = Object.entries(sources)
        for (const [key, expression] of expressions) {
            const assign = (value: unknown) => {
                assignParameter(vnode.props ??= {}, key as string, value)
            }
            const write = (value: unknown, old: unknown) => {
                const previousProps = vnode.props ?? {}
                const nextProps = copyParameters(previousProps)
                assignParameter(nextProps, key as string, value)
                if (!valueBindings.has(vnode)) { assign(value); return }
                if (vnode.arrangable) {
                    updateProps(vnode.arrangable, nextProps, previousProps, false)
                } else if (vnode.el && vnode.shapeFlag & ShapeFlags.LAYOUT_INVOCATION) {
                    hostPatchProp(vnode.el, key as string, old, value, owner, expression.source)
                }
                vnode.props = nextProps
            }
            let binding = retained?.get(key)
            if (binding) {
                assign(binding.currentValue())
                binding.refresh(expression, write)
            } else {
                const created = new ValueBinding(expression, owner, write)
                binding = created
                mounting?.rollback.push(() => created.stop())
            }
            next.set(key, binding)
        }
        retained?.forEach((binding, key) => { if (!next.has(key)) binding.stop() })
        if (previous) valueBindings.delete(previous)
        if (next.size) valueBindings.set(vnode, next)
    }

    // Note: functions inside this closure should use `const xxx = () => {}`
    // style in order to prevent being inlined by minifiers.
    const patchNow: PatchFn = (
        n1,
        n2,
        container,
        anchor = null,
        parentArrangable = null,
        optimized = __DEV__ && isHmrUpdating ? false : !!n2.dynamicChildren,
    ) => {
        if (n1 === n2) {
            return
        }

        // 协调过程读取宿主账本不属于结构依赖；嵌套 render/value effect 自行启用追踪
        pauseTracking()
        try {
            // patching & not same type, unmount old tree
            if (n1 && !isSameVNodeType(n1, n2)) {
                anchor = getNextHostNode(n1)
                unmount(n1, parentArrangable, true)
                n1 = null
            }
            prepareValueBindings(n1, n2, parentArrangable)

            if (n2.patchFlag === PatchFlags.BAIL) {
                optimized = false
                n2.dynamicChildren = null
            }

            const { type, shapeFlag } = n2
            switch (type) {
                case Content:
                    processContent(n1, n2, container, anchor, parentArrangable)
                    break
                case Comment:
                    processCommentNode(n1, n2, container, anchor)
                    break
                case Fragment:
                    processFragment(
                        n1,
                        n2,
                        container,
                        anchor,
                        parentArrangable,
                        optimized,
                    )
                    break
                default:
                    if (shapeFlag & ShapeFlags.LAYOUT_INVOCATION) {
                        processLayout(
                            n1,
                            n2,
                            container,
                            anchor,
                            parentArrangable,
                            optimized,
                        )
                    } else if (shapeFlag & ShapeFlags.ARRANGABLE) {
                        processArrangable(
                            n1,
                            n2,
                            container,
                            anchor,
                            parentArrangable,
                            optimized,
                        )
                    } else if (__DEV__) {
                        warn('Invalid VNode type:', type, `(${typeof type})`)
                    }
            }

        } finally {
            resetTracking()
        }
    }

    const processContent = (previous: VNode | null, vnode: VNode, container: RendererElement, anchor: RendererNode | null, owner: ArrangableInstance | null) => {
        if (previous?.contentScope) {
            const retained = vnode.contentScope = previous.contentScope
            retained.owner = vnode
            retained.effect.run()
            return
        }

        // 内容的生命周期由结构树管理，缓存中的兄弟内容不能被外层恢复操作唤醒
        const lifetime = effectScope(true)
        mounting?.rollback.push(() => lifetime.stop())
        const scope = { owner: vnode, tree: null, lifetime } as ContentScope
        scope.effect = lifetime.run(() => new ReactiveEffect(() => {
            const next = createVNode(Fragment, null, scope.owner.content!())
            const parent = scope.tree?.el ? hostParentNode(scope.tree.el)! : container
            afterSubtree(() => lifetime.run(() => patch(scope.tree, next, parent, anchor, owner, false)), () => {
                scope.tree = next
                scope.owner.el = next.el
                scope.owner.anchor = next.anchor
            })
        }))!
        scope.job = () => {
            if (lifetime.active) scope.effect.runIfDirty()
        }
        scope.job.id = owner?.uid
        scope.job.i = owner ?? undefined
        scope.effect.scheduler = () => queueJob(scope.job)
        vnode.contentScope = scope
        try { scope.effect.run() } catch (error) {
            scope.job.flags = (scope.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
            lifetime.stop()
            throw error
        }
    }

    const processCommentNode: ProcessAnchorFn = (
        n1,
        n2,
        container,
        anchor,
    ) => {
        if (n1 == null) {
            insertMountedNode(
                (n2.el = hostCreateComment((n2.children as string) || '')),
                container,
                anchor,
            )
        } else {
            // there's no support for dynamic comments
            n2.el = n1.el
        }
    }

    const processLayout = (
        n1: VNode | null,
        n2: VNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {

        if (n1 == null) {
            mountLayout(
                n2,
                container,
                anchor,
                parentArrangable,
                optimized,
            )
        } else {
            patchLayout(n1, n2, parentArrangable, optimized)
        }
    }

    const mountLayout = (
        vnode: VNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        let el: RendererElement
        const { props, shapeFlag } = vnode

        el = vnode.el = hostCreateLayout()

        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            mountChildren(
                vnode.children as VNodeArrayChildren,
                el,
                null,
                parentArrangable,
                optimized,
            )
        }

        // props
        if (props) {
            for (const key in props) {
                if (!isReservedProp(key)) {
                    hostPatchProp(el, key, null, props[key], parentArrangable, vnode.valueSources?.[key]?.source)
                }
            }
        }

        if ((__DEV__)) {
            def(el, '__vnode', vnode, true)
            def(el, '__vueParentArrangable', parentArrangable, true)
        }
        insertMountedNode(el, container, anchor)
    }

    const mountChildren: MountChildrenFn = (children, container, anchor, parentArrangable, optimized, start = 0) => {
        const indices = Array.from({ length: children.length - start }, (_, index) => start + index)
        if (mounting) indices.reverse()
        for (const i of indices) {
            const child = (children[i] = optimized ? cloneIfMounted(children[i] as VNode) : normalizeVNode(children[i]))
            patch(null, child, container, anchor, parentArrangable, optimized)
        }
    }

    const patchLayout = (
        n1: VNode,
        n2: VNode,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        const el = (n2.el = n1.el!)
        if ((__DEV__)) {
            el.__vnode = n2
        }
        let { patchFlag, dynamicChildren } = n2
        // #1426 take the old vnode's patch flag into account since user may clone a
        // compiler-generated vnode, which de-opts to FULL_PROPS
        patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS
        const oldProps = n1.props || EMPTY_OBJ
        const newProps = n2.props || EMPTY_OBJ

        // disable recurse in beforeUpdate hooks
        parentArrangable && toggleRecurse(parentArrangable, false)
        parentArrangable && toggleRecurse(parentArrangable, true)

        if (__DEV__ && isHmrUpdating) {
            // HMR updated, force full diff
            patchFlag = 0
            optimized = false
            dynamicChildren = null
        }

        if (dynamicChildren) {
            patchBlockChildren(
                n1.dynamicChildren!,
                dynamicChildren,
                el,
                parentArrangable,

            )
            if (__DEV__) {
                // necessary for HMR
                traverseStaticChildren(n1, n2)
            }
        } else if (!optimized) {
            // full diff
            patchChildren(
                n1,
                n2,
                el,
                null,
                parentArrangable,
                false,
            )
        }

        if (patchFlag > 0) {
            // the presence of a patchFlag means this element's render code was
            // generated by the compiler and can take the fast path.
            // in this path old node and new node are guaranteed to have the same shape
            // (i.e. at the exact same position in the source template)
            if (patchFlag & PatchFlags.FULL_PROPS) {
                // element props contain dynamic keys, full diff needed
                patchProps(el, oldProps, newProps, parentArrangable)
            } else {
                // Dynamic native input keys; value equality is handled uniformly.
                if (patchFlag & PatchFlags.PROPS) {
                    // if the flag is present then dynamicProps must be non-null
                    const propsToUpdate = n2.dynamicProps!
                    for (let i = 0; i < propsToUpdate.length; i++) {
                        const key = propsToUpdate[i]
                        const prev = oldProps[key]
                        const next = newProps[key]
                        if (next !== prev) {
                            hostPatchProp(el, key, prev, next, parentArrangable)
                        }
                    }
                }
            }

        } else if (!optimized && dynamicChildren == null) {
            // unoptimized, full diff
            patchProps(el, oldProps, newProps, parentArrangable)
        }
    }

    // The fast path for blocks.
    const patchBlockChildren: PatchBlockChildrenFn = (
        oldChildren,
        newChildren,
        fallbackContainer,
        parentArrangable,

    ) => {
        for (let i = 0; i < newChildren.length; i++) {
            const oldVNode = oldChildren[i]
            const newVNode = newChildren[i]
            // Determine the container (parent element) for the patch.
            const container =
                // which will not have a mounted element
                oldVNode.el &&
                    // - In the case of a Fragment, we need to provide the actual parent
                    // of the Fragment itself so it can move its children.
                    (oldVNode.type === Fragment ||
                        // - In the case of different nodes, there is going to be a replacement
                        // which also requires the correct parent container
                        !isSameVNodeType(oldVNode, newVNode) ||
                        // - In the case of a arrangable, it could contain anything.
                        oldVNode.shapeFlag &
                        (ShapeFlags.ARRANGABLE))
                    ? hostParentNode(oldVNode.el)!
                    : // In other cases, the parent container is not actually used so we

                    fallbackContainer
            patch(
                oldVNode,
                newVNode,
                container,
                null,
                parentArrangable,
                true,
            )
        }
    }

    const patchProps = (
        el: RendererElement,
        oldProps: Data,
        newProps: Data,
        parentArrangable: ArrangableInstance | null,
    ) => {
        if (oldProps !== newProps) {
            if (oldProps !== EMPTY_OBJ) {
                for (const key in oldProps) {
                    if (!isReservedProp(key) && !(key in newProps)) {
                        hostPatchProp(
                            el,
                            key,
                            oldProps[key],
                            null,
                            parentArrangable,
                        )
                    }
                }
            }
            for (const key in newProps) {
                // empty string is not valid prop
                if (isReservedProp(key)) continue
                const next = newProps[key]
                const prev = oldProps[key]
                if (next !== prev) {
                    hostPatchProp(el, key, prev, next, parentArrangable)
                }
            }
        }
    }

    const processFragment = (
        n1: VNode | null,
        n2: VNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateComment(''))!
        const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateComment(''))!

        let { patchFlag, dynamicChildren } = n2

        if (
            __DEV__ &&
            // #5523 dev root fragment may inherit directives
            (isHmrUpdating || patchFlag & PatchFlags.DEV_ROOT_FRAGMENT)
        ) {
            // HMR updated / Dev root fragment (w/ comments), force full diff
            patchFlag = 0
            optimized = false
            dynamicChildren = null
        }

        // check if this is a slot fragment with :slotted scope ids

        if (n1 == null) {
            insertMountedNode(fragmentStartAnchor, container, anchor)
            insertMountedNode(fragmentEndAnchor, container, anchor)
            // a fragment can only have array children
            // since they are either generated by the compiler, or implicitly created
            // from arrays.
            mountChildren(
                // #10007
                // such fragment like `<></>` will be compiled into
                // a fragment which doesn't have a children.
                // In this case fallback to an empty array
                (n2.children || []) as VNodeArrayChildren,
                container,
                fragmentEndAnchor,
                parentArrangable,
                optimized,
            )
        } else {
            if (
                patchFlag > 0 &&
                patchFlag & PatchFlags.STABLE_FRAGMENT &&
                dynamicChildren &&
                // #2715 the previous fragment could've been a BAILed one as a result
                // of renderSlot() with no valid children
                n1.dynamicChildren &&
                n1.dynamicChildren.length === dynamicChildren.length
            ) {
                // a stable fragment (template root or <template v-for>) doesn't need to
                // patch children order, but it may contain dynamicChildren.
                patchBlockChildren(
                    n1.dynamicChildren,
                    dynamicChildren,
                    container,
                    parentArrangable,

                )
                if (__DEV__) {
                    // necessary for HMR
                    traverseStaticChildren(n1, n2)
                } else if (
                    // #2080 if the stable fragment has a key, it's a <template v-for> that may
                    //  get moved around. Make sure all root level vnodes inherit el.
                    // #2134 or if it's a arrangable root, it may also get moved around
                    // as the arrangable is being moved.
                    n2.key != null ||
                    (parentArrangable && n2 === parentArrangable.subTree)
                ) {
                    traverseStaticChildren(n1, n2, true /* shallow */)
                }
            } else {
                // keyed / unkeyed, or manual fragments.
                // for keyed & unkeyed, since they are compiler generated from v-for,
                // each child is guaranteed to be a block so the fragment will never
                // have dynamicChildren.
                patchChildren(
                    n1,
                    n2,
                    container,
                    fragmentEndAnchor,
                    parentArrangable,
                    optimized,
                )
            }
        }
    }

    const processArrangable = (
        n1: VNode | null,
        n2: VNode,
        container: RendererElement,
        anchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        if (n1 == null) {
            mountArrangable(n2, container, anchor, parentArrangable, optimized)
        } else {
            updateArrangable(n1, n2, optimized)
        }
    }

    const mountArrangable: MountArrangableFn = (
        initialVNode,
        container,
        anchor,
        parentArrangable,
        optimized,
    ) => {
        const instance = initialVNode.arrangable = createArrangableInstance(initialVNode, parentArrangable)
        mounting?.rollback.push(() => instance.scope.stop())

        if (__DEV__ && instance.type.__hmrId) {
            registerHMR(instance)
            mounting?.rollback.push(() => unregisterHMR(instance))
        }

        if (__DEV__) {
            pushWarningContext(initialVNode)

        }

        try {
            setupArrangable(instance, optimized)
            if (__DEV__ && isHmrUpdating) initialVNode.el = null

            setupRenderEffect(instance, initialVNode, container, anchor, optimized)
        } finally {
            if (__DEV__) popWarningContext()
        }
    }

    const updateArrangable = (n1: VNode, n2: VNode, optimized: boolean) => {
        const instance = (n2.arrangable = n1.arrangable)!
        const structureChanged = shouldUpdateArrangable(n1, n2, optimized)
        n2.el = n1.el
        // props 先进入反应式对象，实际订阅决定结构 effect 或值 binding 是否执行
        updateArrangablePreRender(instance, n2, optimized)
        if (structureChanged || instance.effect.dirty) instance.update()
    }

    const setupRenderEffect: SetupRenderEffectFn = (
        instance,
        initialVNode,
        container,
        anchor,
        optimized,
    ) => {
        const arrangableUpdateFn = () => {
            if (!instance.isMounted) {
                const { el, props } = initialVNode
                const { bm, m, parent, root, type } = instance

                toggleRecurse(instance, false)
                // beforeMount hook
                if (bm) {
                    invokeArrayFns(bm)
                }

                toggleRecurse(instance, true)

                const subTree = instance.subTree = renderArrangableRoot(instance)
                afterSubtree(() => patch(null, subTree, container, anchor, instance), () => {
                    initialVNode.el = subTree.el
                    if (m) afterMount(() => queuePostRenderEffect(m))
                    instance.isMounted = true

                    // 首次挂载完成后释放仅用于构造的引用
                    initialVNode = container = anchor = null as any
                })
            } else {
                let { next, bu, u, parent, vnode } = instance

                // updateArrangable
                // This is triggered by mutation of arrangable's own state (next: null)
                // OR parent calling processArrangable (next: VNode)
                let originNext = next
                if (__DEV__) {
                    pushWarningContext(next || instance.vnode)
                }

                // Disallow arrangable effect recursion during pre-lifecycle hooks.
                toggleRecurse(instance, false)
                if (next) {
                    next.el = vnode.el
                    updateArrangablePreRender(instance, next, optimized)
                } else {
                    next = vnode
                }

                // beforeUpdate hook
                if (bu) {
                    invokeArrayFns(bu)
                }

                toggleRecurse(instance, true)

                // render

                const nextTree = renderArrangableRoot(instance)

                const prevTree = instance.subTree
                instance.subTree = nextTree

                patch(
                    prevTree,
                    nextTree,
                    hostParentNode(prevTree.el!)!,
                    // anchor may have changed if it's in a fragment
                    getNextHostNode(prevTree),
                    instance,

                )

                next.el = nextTree.el
                if (originNext === null) {
                    // self-triggered update. In case of HOC, update parent arrangable
                    // vnode el. HOC is indicated by parent instance's subTree pointing
                    // to child arrangable's vnode
                    updateHOCHostEl(instance, nextTree.el)
                }
                // updated hook
                if (u) {
                    queuePostRenderEffect(u)
                }

                if (__DEV__) {
                    popWarningContext()
                }
            }
        }

        // create reactive effect for rendering
        instance.scope.on()
        const effect = (instance.effect = new ReactiveEffect(() => instance.scope.run(arrangableUpdateFn)))
        instance.scope.off()

        const update = (instance.update = effect.run.bind(effect))
        const job: SchedulerJob = (instance.job = effect.runIfDirty.bind(effect))
        job.i = instance
        job.id = instance.uid
        effect.scheduler = () => queueJob(job)

        // allowRecurse
        // #1801, #2043 arrangable render effects should allow recursive updates
        toggleRecurse(instance, true)

        if (__DEV__) {
            effect.onTrack = instance.rtc
                ? e => invokeArrayFns(instance.rtc!, e)
                : void 0
            effect.onTrigger = instance.rtg
                ? e => invokeArrayFns(instance.rtg!, e)
                : void 0
        }

        update()
    }

    const updateArrangablePreRender = (
        instance: ArrangableInstance,
        nextVNode: VNode,
        optimized: boolean,
    ) => {
        nextVNode.arrangable = instance
        const prevProps = instance.vnode.props
        instance.vnode = nextVNode
        instance.next = null
        updateProps(instance, nextVNode.props, prevProps, optimized)
        updateSlots(instance, nextVNode.children, optimized)

        pauseTracking()
        // props update may have triggered pre-flush watchers.
        // flush them before the render update.
        flushPreFlushCbs(instance)
        resetTracking()
    }

    const patchChildren: PatchChildrenFn = (
        n1,
        n2,
        container,
        anchor,
        parentArrangable,
        optimized = false,
    ) => {
        const c1 = n1 && n1.children
        const prevShapeFlag = n1 ? n1.shapeFlag : 0
        const c2 = n2.children

        const { patchFlag, shapeFlag } = n2
        // fast path
        if (patchFlag > 0) {
            if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
                // this could be either fully-keyed or mixed (some keyed some not)
                // presence of patchFlag means children are guaranteed to be arrays
                patchKeyedChildren(
                    c1 as VNode[],
                    c2 as VNodeArrayChildren,
                    container,
                    anchor,
                    parentArrangable,
                    optimized,
                )
                return
            } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
                // unkeyed
                patchUnkeyedChildren(
                    c1 as VNode[],
                    c2 as VNodeArrayChildren,
                    container,
                    anchor,
                    parentArrangable,
                    optimized,
                )
                return
            }
        }

        if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
                patchKeyedChildren(c1 as VNode[], c2 as VNodeArrayChildren, container, anchor, parentArrangable, optimized)
            } else {
                unmountChildren(c1 as VNode[], parentArrangable, true)
            }
        } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            mountChildren(c2 as VNodeArrayChildren, container, anchor, parentArrangable, optimized)
        }
    }

    const patchUnkeyedChildren = (
        c1: VNode[],
        c2: VNodeArrayChildren,
        container: RendererElement,
        anchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        c1 = c1 || EMPTY_ARR
        c2 = c2 || EMPTY_ARR
        const oldLength = c1.length
        const newLength = c2.length
        const commonLength = Math.min(oldLength, newLength)
        let i
        for (i = 0; i < commonLength; i++) {
            const nextChild = (c2[i] = optimized
                ? cloneIfMounted(c2[i] as VNode)
                : normalizeVNode(c2[i]))
            patch(
                c1[i],
                nextChild,
                container,
                null,
                parentArrangable,
                optimized,
            )
        }
        if (oldLength > newLength) {
            // remove old
            unmountChildren(
                c1,
                parentArrangable,
                true,
                false,
                commonLength,
            )
        } else {
            // mount new
            mountChildren(
                c2,
                container,
                anchor,
                parentArrangable,
                optimized,
                commonLength,
            )
        }
    }

    // can be all-keyed or mixed
    const patchKeyedChildren = (
        c1: VNode[],
        c2: VNodeArrayChildren,
        container: RendererElement,
        parentAnchor: RendererNode | null,
        parentArrangable: ArrangableInstance | null,
        optimized: boolean,
    ) => {
        let i = 0
        const l2 = c2.length
        let e1 = c1.length - 1 // prev ending index
        let e2 = l2 - 1 // next ending index

        // 1. sync from start
        // (a b) c
        // (a b) d e
        while (i <= e1 && i <= e2) {
            const n1 = c1[i]
            const n2 = (c2[i] = optimized
                ? cloneIfMounted(c2[i] as VNode)
                : normalizeVNode(c2[i]))
            if (isSameVNodeType(n1, n2)) {
                patch(
                    n1,
                    n2,
                    container,
                    null,
                    parentArrangable,
                    optimized,
                )
            } else {
                break
            }
            i++
        }

        // 2. sync from end
        // a (b c)
        // d e (b c)
        while (i <= e1 && i <= e2) {
            const n1 = c1[e1]
            const n2 = (c2[e2] = optimized
                ? cloneIfMounted(c2[e2] as VNode)
                : normalizeVNode(c2[e2]))
            if (isSameVNodeType(n1, n2)) {
                patch(
                    n1,
                    n2,
                    container,
                    null,
                    parentArrangable,
                    optimized,
                )
            } else {
                break
            }
            e1--
            e2--
        }

        // 3. common sequence + mount
        // (a b)
        // (a b) c
        // i = 2, e1 = 1, e2 = 2
        // (a b)
        // c (a b)
        // i = 0, e1 = -1, e2 = 0
        if (i > e1) {
            if (i <= e2) {
                const nextPos = e2 + 1
                const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
                while (i <= e2) {
                    patch(
                        null,
                        (c2[i] = optimized
                            ? cloneIfMounted(c2[i] as VNode)
                            : normalizeVNode(c2[i])),
                        container,
                        anchor,
                        parentArrangable,
                        optimized,
                    )
                    i++
                }
            }
        }

        // 4. common sequence + unmount
        // (a b) c
        // (a b)
        // i = 2, e1 = 2, e2 = 1
        // a (b c)
        // (b c)
        // i = 0, e1 = 0, e2 = -1
        else if (i > e2) {
            while (i <= e1) {
                unmount(c1[i], parentArrangable, true)
                i++
            }
        }

        // 5. unknown sequence
        // [i ... e1 + 1]: a b [c d e] f g
        // [i ... e2 + 1]: a b [e d c h] f g
        // i = 2, e1 = 4, e2 = 5
        else {
            const s1 = i // prev starting index
            const s2 = i // next starting index

            // 5.1 build key:index map for newChildren
            const keyToNewIndexMap: Map<PropertyKey, number> = new Map()
            for (i = s2; i <= e2; i++) {
                const nextChild = (c2[i] = optimized
                    ? cloneIfMounted(c2[i] as VNode)
                    : normalizeVNode(c2[i]))
                if (nextChild.key != null) {
                    if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
                        warn(
                            `Duplicate keys found during update:`,
                            JSON.stringify(nextChild.key),
                            `Make sure keys are unique.`,
                        )
                    }
                    keyToNewIndexMap.set(nextChild.key, i)
                }
            }

            // 5.2 loop through old children left to be patched and try to patch
            // matching nodes & remove nodes that are no longer present
            let j
            let patched = 0
            const toBePatched = e2 - s2 + 1
            let moved = false
            // used to track whether any node has moved
            let maxNewIndexSoFar = 0
            // works as Map<newIndex, oldIndex>
            // Note that oldIndex is offset by +1
            // and oldIndex = 0 is a special value indicating the new node has
            // no corresponding old node.
            // used for determining longest stable subsequence
            const newIndexToOldIndexMap = new Array(toBePatched)
            for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

            for (i = s1; i <= e1; i++) {
                const prevChild = c1[i]
                if (patched >= toBePatched) {
                    // all new children have been patched so this can only be a removal
                    unmount(prevChild, parentArrangable, true)
                    continue
                }
                let newIndex
                if (prevChild.key != null) {
                    newIndex = keyToNewIndexMap.get(prevChild.key)
                } else {
                    // key-less node, try to locate a key-less node of the same type
                    for (j = s2; j <= e2; j++) {
                        if (
                            newIndexToOldIndexMap[j - s2] === 0 &&
                            isSameVNodeType(prevChild, c2[j] as VNode)
                        ) {
                            newIndex = j
                            break
                        }
                    }
                }
                if (newIndex === undefined) {
                    unmount(prevChild, parentArrangable, true)
                } else {
                    newIndexToOldIndexMap[newIndex - s2] = i + 1
                    if (newIndex >= maxNewIndexSoFar) {
                        maxNewIndexSoFar = newIndex
                    } else {
                        moved = true
                    }
                    patch(
                        prevChild,
                        c2[newIndex] as VNode,
                        container,
                        null,
                        parentArrangable,
                        optimized,
                    )
                    patched++
                }
            }

            // 5.3 move and mount
            // generate longest stable subsequence only when nodes have moved
            const increasingNewIndexSequence = moved
                ? getSequence(newIndexToOldIndexMap)
                : EMPTY_ARR
            j = increasingNewIndexSequence.length - 1
            // looping backwards so that we can use last patched node as anchor
            for (i = toBePatched - 1; i >= 0; i--) {
                const nextIndex = s2 + i
                const nextChild = c2[nextIndex] as VNode
                const anchorVNode = c2[nextIndex + 1] as VNode
                const anchor =
                    nextIndex + 1 < l2
                        ?
                        anchorVNode.el
                        : parentAnchor
                if (newIndexToOldIndexMap[i] === 0) {
                    // mount new
                    patch(
                        null,
                        nextChild,
                        container,
                        anchor,
                        parentArrangable,
                        optimized,
                    )
                } else if (moved) {
                    // move if:
                    // There is no stable subsequence (e.g. a reverse)
                    // OR current node is not among the stable sequence
                    if (j < 0 || i !== increasingNewIndexSequence[j]) {
                        move(nextChild, container, anchor)
                    } else {
                        j--
                    }
                }
            }
        }
    }

    const move: MoveFn = (
        vnode,
        container,
        anchor,

    ) => {
        const { el, type, children, shapeFlag } = vnode
        if (vnode.contentScope) {
            move(vnode.contentScope.tree!, container, anchor)
            return
        }
        if (shapeFlag & ShapeFlags.ARRANGABLE) {
            move(vnode.arrangable!.subTree, container, anchor)
            return
        }

        if (type === Fragment) {
            hostInsert(el!, container, anchor)
            for (let i = 0; i < (children as VNode[]).length; i++) {
                move((children as VNode[])[i], container, anchor)
            }
            hostInsert(vnode.anchor!, container, anchor)
            return
        }

        hostInsert(el!, container, anchor)
    }

    let unmounting: (() => void)[] | undefined

    const unmount: UnmountFn = (...args) => {
        if (unmounting) { unmounting.push(() => unmountNow(...args)); return }

        const tasks = unmounting = [] as (() => void)[]
        try {
            unmountNow(...args)
            while (tasks.length) tasks.pop()!()
        } finally {
            unmounting = undefined
        }
    }

    const unmountNow: UnmountFn = (
        vnode,
        parentArrangable,
        doRemove = false,
        optimized = false,
    ) => {
        if (vnode.contentScope) {
            const scope = vnode.contentScope
            scope.job.flags = (scope.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
            scope.lifetime.stop()
            if (scope.tree) unmount(scope.tree, parentArrangable, doRemove, false)
            return
        }

        const {
            type,
            props,
            children,
            dynamicChildren,
            shapeFlag,
            patchFlag,
            cacheIndex,
        } = vnode

        if (patchFlag === PatchFlags.BAIL) {
            optimized = false
        }

        // 卸载时清理编译器静态缓存
        if (cacheIndex != null) {
            parentArrangable!.renderCache[cacheIndex] = undefined
        }

        valueBindings.get(vnode)?.forEach(binding => binding.stop())
        valueBindings.delete(vnode)

        if (shapeFlag & ShapeFlags.ARRANGABLE) {
            unmountArrangable(vnode.arrangable!, doRemove)
        } else {

            if (doRemove) unmounting!.push(() => remove(vnode))
            if (
                dynamicChildren &&
                // #1153: fast path should not be taken for non-stable (v-for) fragments
                (type !== Fragment ||
                    (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
            ) {
                // fast path for block nodes: only need to unmount dynamic children.
                unmountChildren(
                    dynamicChildren,
                    parentArrangable,
                    false,
                    true,
                )
            } else if (
                (type === Fragment &&
                    patchFlag &
                    (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) ||
                (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN)
            ) {
                unmountChildren(children as VNode[], parentArrangable)
            }

        }
    }

    const remove: RemoveFn = vnode => {
        if (vnode.type === Fragment) removeFragment(vnode.el!, vnode.anchor!)
        else hostRemove(vnode.el!)
    }

    const removeFragment = (cur: RendererNode, end: RendererNode) => {

        let next
        while (cur !== end) {
            next = hostNextSibling(cur)!
            hostRemove(cur)
            cur = next
        }
        hostRemove(end)
    }

    const unmountArrangable = (
        instance: ArrangableInstance,
        doRemove?: boolean,
    ) => {
        if (__DEV__ && instance.type.__hmrId) {
            unregisterHMR(instance)
        }

        const { bum, scope, job, subTree, um, m, a } = instance
        invalidateMount(m)
        invalidateMount(a)

        // beforeUnmount hook
        if (bum) {
            invokeArrayFns(bum)
        }

        // stop effects in arrangable scope
        scope.stop()

        unmounting!.push(() => {
            if (um) queuePostRenderEffect(um)
            queuePostRenderEffect(() => { instance.isUnmounted = true })
        })

        if (job) {
            // so that scheduler will no longer invoke it
            job.flags! |= SchedulerJobFlags.DISPOSED
            unmount(subTree, instance, doRemove)
        }
    }

    const unmountChildren: UnmountChildrenFn = (
        children,
        parentArrangable,
        doRemove = false,
        optimized = false,
        start = 0,
    ) => {
        for (let i = children.length - 1; i >= start; i--) {
            unmount(children[i], parentArrangable, doRemove, optimized)
        }
    }

    const getNextHostNode: NextFn = vnode => {
        while (vnode.shapeFlag & ShapeFlags.ARRANGABLE) vnode = vnode.arrangable!.subTree
        return hostNextSibling((vnode.anchor || vnode.el)!)
    }

    let isFlushing = false
    const render: RootRenderFunction = (vnode, container) => {
        let instance
        if (vnode == null) {
            if (container._vnode) {
                unmount(container._vnode, null, true)
                instance = container._vnode.arrangable
            }
        } else {
            patch(
                container._vnode || null,
                vnode,
                container,
                null,
                null,

            )
        }
        container._vnode = vnode
        if (!isFlushing) {
            isFlushing = true
            flushPreFlushCbs(instance)
            flushPostFlushCbs()
            isFlushing = false
        }
    }

    return {
        render,
        createApp: createAppAPI(render),
    }
}

function toggleRecurse(
    { effect, job }: ArrangableInstance,
    allowed: boolean,
) {
    if (allowed) {
        effect.flags |= EffectFlags.ALLOW_RECURSE
        job.flags! |= SchedulerJobFlags.ALLOW_RECURSE
    } else {
        effect.flags &= ~EffectFlags.ALLOW_RECURSE
        job.flags! &= ~SchedulerJobFlags.ALLOW_RECURSE
    }
}

export function traverseStaticChildren(
    n1: VNode,
    n2: VNode,
    shallow = false,
): void {
    const ch1 = n1.children
    const ch2 = n2.children
    if (isArray(ch1) && isArray(ch2)) {
        for (let i = 0; i < ch1.length; i++) {
            // this is only called in the optimized path so array children are
            // guaranteed to be vnodes
            const c1 = ch1[i] as VNode
            let c2 = ch2[i] as VNode
            if (c2.shapeFlag & ShapeFlags.LAYOUT_INVOCATION && !c2.dynamicChildren) {
                if (c2.patchFlag <= 0) {
                    c2 = ch2[i] = cloneIfMounted(ch2[i] as VNode)
                    c2.el = c1.el
                }
                if (!shallow && c2.patchFlag !== PatchFlags.BAIL)
                    traverseStaticChildren(c1, c2)
            }
            // #2324 also inherit for comment nodes, but not placeholders (e.g. v-if which
            // would have received .el during block patch)
            if (c2.type === Comment && !c2.el) {
                c2.el = c1.el
            }

            if (__DEV__) {
                c2.el && (c2.el.__vnode = c2)
            }
        }
    }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
    const p = arr.slice()
    const result = [0]
    let i, j, u, v, c
    const len = arr.length
    for (i = 0; i < len; i++) {
        const arrI = arr[i]
        if (arrI !== 0) {
            j = result[result.length - 1]
            if (arr[j] < arrI) {
                p[i] = j
                result.push(i)
                continue
            }
            u = 0
            v = result.length - 1
            while (u < v) {
                c = (u + v) >> 1
                if (arr[result[c]] < arrI) {
                    u = c + 1
                } else {
                    v = c
                }
            }
            if (arrI < arr[result[u]]) {
                if (u > 0) {
                    p[i] = result[u - 1]
                }
                result[u] = i
            }
        }
    }
    u = result.length
    v = result[u - 1]
    while (u-- > 0) {
        result[u] = v
        v = p[v]
    }
    return result
}

export function invalidateMount(hooks: LifecycleHook): void {
    if (hooks) {
        for (let i = 0; i < hooks.length; i++)
            hooks[i].flags! |= SchedulerJobFlags.DISPOSED
    }
}
