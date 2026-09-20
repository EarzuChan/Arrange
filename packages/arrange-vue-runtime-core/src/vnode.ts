import {
    type ReactiveFlags,
    type Ref,
    isProxy,
    isRef,
    toRaw,
} from '@arrange/vue-reactivity'
import {
    EMPTY_ARR,
    camelize,
    hasOwn,
    PatchFlags,
    ShapeFlags,
    SlotFlags,
    extend,
    isArray,
    isFunction,
    isObject,
    isString,
} from '@arrange/vue-shared'
import type { AppContext } from './apiCreateApp.ts'
import {
    type ClassArrangable,
    type Arrangable,
    type ArrangableInstance,
    type ConcreteArrangable,
    type Data,
    isClassArrangable,
} from './arrangable.ts'
import type { ArrangablePublicInstance } from './arrangablePublicInstance.ts'
import {
    currentRenderingInstance,
} from './arrangableRenderContext.ts'
import type { RawSlots } from './arrangableSlots.ts'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling.ts'
import { NULL_DYNAMIC_ARRANGABLE } from './helpers/resolveAssets.ts'
import { hmrDirtyArrangables } from './hmr.ts'
import { isInternalObject } from './internalObject.ts'
import type { RendererElement, RendererNode } from './renderer.ts'
import { type ValueExpression, arrangeValue, isValueExpression } from './valueBinding.ts'
import { warn } from './warning.ts'

export const Fragment = Symbol.for('v-fgt') as any as {
    __isFragment: true
    new(): {
        $props: VNodeProps
    }
}
export const Content: unique symbol = Symbol('Arrange 内容调用')
export const LayoutInvocation: unique symbol = Symbol('Arrange 布局调用')
export const Comment: unique symbol = Symbol.for('v-cmt')

export type VNodeTypes =
    | string
    | VNode
    | Arrangable
    | typeof Comment
    | typeof Content
    | typeof LayoutInvocation
    | typeof Fragment

export type VNodeProps = { key?: PropertyKey }

type VNodeChildAtom =
    | VNode
    | string
    | number
    | boolean
    | null
    | undefined
    | void

export type VNodeArrayChildren = Array<VNodeArrayChildren | VNodeChildAtom>

export type VNodeChild = VNodeChildAtom | VNodeArrayChildren

export type VNodeNormalizedChildren =
    | string
    | VNodeArrayChildren
    | RawSlots
    | null

export interface VNode<
    HostNode = RendererNode,
    HostElement = RendererElement,
    ExtraProps = { [key: string]: any },
> {
    /**
     * @internal
     */
    __v_isVNode: true

    /**
     * @internal
     */
    [ReactiveFlags.SKIP]: true

    type: VNodeTypes
    props: (VNodeProps & ExtraProps) | null
    valueSources: Record<string, ValueExpression> | null
    content?: () => VNodeArrayChildren
    contentScope?: import('./contentScope.ts').ContentScope
    key: PropertyKey | null
    /**
     * SFA only. This is assigned on vnode creation using currentScopeId
     * which is set alongside currentRenderingInstance.
     */

    children: VNodeNormalizedChildren
    arrangable: ArrangableInstance | null

    el: HostNode | null
    anchor: HostNode | null // fragment anchor
    /**
     * number of elements contained in a static vnode
     * @internal
     */
    staticCount: number

    // optimization only
    shapeFlag: number
    patchFlag: number
    /**
     * @internal
     */
    dynamicProps: string[] | null
    /**
     * @internal
     */
    dynamicChildren: VNode[] | null

    // application root node only
    appContext: AppContext | null

    /**
     * @internal lexical scope owner instance
     */
    ctx: ArrangableInstance | null

    // 编译器静态缓存的回收位置
    cacheIndex?: number
}

// Since v-if and v-for are the two possible ways node structure can dynamically
// change, once we consider v-if branches and each v-for fragment a block, we
// can divide a template into nested blocks, and within each block the node
// structure would be stable. This allows us to skip most children diffing
// and only worry about the dynamic nodes (indicated by patch flags).
export const blockStack: VNode['dynamicChildren'][] = []
export let currentBlock: VNode['dynamicChildren'] = null

/**
 * Open a block.
 * This must be called before `createBlock`. It cannot be part of `createBlock`
 * because the children of the block are evaluated before `createBlock` itself
 * is called. The generated code typically looks like this:
 *
 * ```js
 * function render() {
 *   return (openBlock(),createBlock('div', null, [...]))
 * }
 * ```
 * disableTracking is true when creating a v-for fragment block, since a v-for
 * fragment always diffs its children.
 *
 * @private
 */
export function openBlock(disableTracking = false): void {
    blockStack.push((currentBlock = disableTracking ? null : []))
}

export function closeBlock(): void {
    blockStack.pop()
    currentBlock = blockStack[blockStack.length - 1] || null
}

// Whether we should be tracking dynamic child nodes inside a block.
// Only tracks when this value is > 0
// We are not using a simple boolean because this value may need to be
// incremented/decremented by nested usage of v-once (see below)
export let isBlockTreeEnabled = 1

// 编译器缓存确定的静态结构时暂停动态节点收集
export function setBlockTracking(value: number): void {
    isBlockTreeEnabled += value
}

function setupBlock(vnode: VNode) {
    // save current block children on the block vnode
    vnode.dynamicChildren =
        isBlockTreeEnabled > 0 ? currentBlock || (EMPTY_ARR as any) : null
    // close block
    closeBlock()
    // a block is always going to be patched, so track it as a child of its
    // parent block
    if (isBlockTreeEnabled > 0 && currentBlock) {
        currentBlock.push(vnode)
    }
    return vnode
}

/**
 * @private
 */
export function createElementBlock(
    type: string | typeof Fragment,
    props?: Record<string, any> | null,
    children?: any,
    patchFlag?: number,
    dynamicProps?: string[],
    shapeFlag?: number,
): VNode {
    return setupBlock(
        createBaseVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            shapeFlag,
            true /* isBlock */,
        ),
    )
}

/**
 * Create a block root vnode. Takes the same exact arguments as `createVNode`.
 * A block root keeps track of dynamic nodes within the block in the
 * `dynamicChildren` array.
 *
 * @private
 */
export function createBlock(
    type: VNodeTypes | ClassArrangable,
    props?: Record<string, any> | null,
    children?: any,
    patchFlag?: number,
    dynamicProps?: string[],
): VNode {
    return setupBlock(
        createVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            true /* isBlock: prevent a block from tracking itself */,
        ),
    )
}

export function isVNode(value: any): value is VNode {
    return value ? value.__v_isVNode === true : false
}

export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
    if (__DEV__ && n2.shapeFlag & ShapeFlags.ARRANGABLE && n1.arrangable) {
        const dirtyInstances = hmrDirtyArrangables.get(n2.type as ConcreteArrangable)
        if (dirtyInstances && dirtyInstances.has(n1.arrangable)) {
            // #7042, ensure the vnode being unmounted during HMR
            // bitwise operations to remove keep alive flags
            n1.retention = undefined
            n2.retention = undefined
            // HMR only: if the arrangable has been hot-updated, force a reload.
            return false
        }
    }
    return n1.type === n2.type && n1.key === n2.key
}

let vnodeArgsTransformer:
    | ((
        args: Parameters<typeof _createVNode>,
        instance: ArrangableInstance | null,
    ) => Parameters<typeof _createVNode>)
    | undefined

/**
 * Internal API for registering an arguments transform for createVNode
 * used for creating stubs in the test-utils
 * It is *internal* but needs to be exposed for test-utils to pick up proper
 * typings
 */
export function transformVNodeArgs(
    transformer?: typeof vnodeArgsTransformer,
): void {
    vnodeArgsTransformer = transformer
}

const createVNodeWithArgsTransform = (
    ...args: Parameters<typeof _createVNode>
): VNode => {
    return _createVNode(
        ...(vnodeArgsTransformer
            ? vnodeArgsTransformer(args, currentRenderingInstance)
            : args),
    )
}

const normalizeKey = ({ key }: VNodeProps): VNode['key'] =>
    key != null ? key : null

function createBaseVNode(
    type: VNodeTypes | ClassArrangable | typeof NULL_DYNAMIC_ARRANGABLE,
    props: (Data & VNodeProps) | null = null,
    children: unknown = null,
    patchFlag = 0,
    dynamicProps: string[] | null = null,
    shapeFlag: number = type === Fragment ? 0 : ShapeFlags.LAYOUT_INVOCATION,
    isBlockNode = false,
    needFullChildrenNormalization = false,
): VNode {
    if (typeof type === 'string') throw new TypeError(`不能通过字符串 ${type} 创建布局实体；请调用 Arrangable 定义`)
    const vnode = {
        __v_isVNode: true,
        __v_skip: true,
        type,
        props,
        valueSources: null,
        key: props && normalizeKey(props),
        children,
        arrangable: null,
        el: null,
        anchor: null,
        staticCount: 0,
        shapeFlag,
        patchFlag,
        dynamicProps,
        dynamicChildren: null,
        appContext: null,
        ctx: currentRenderingInstance,
    } as VNode

    if (needFullChildrenNormalization) {
        normalizeChildren(vnode, children)

    } else {
        normalizeChildren(vnode, children)
    }

    // validate key
    if (__DEV__ && vnode.key !== vnode.key) {
        warn(`VNode created with invalid key (NaN). VNode type:`, vnode.type)
    }

    // track vnode for block tree
    if (
        isBlockTreeEnabled > 0 &&
        // avoid a block node from tracking itself
        !isBlockNode &&
        // has current parent block
        currentBlock &&
        // presence of a patch flag indicates this node needs patching on updates.
        // arrangable nodes also should always be patched, because even if the
        // arrangable doesn't need to update, it needs to persist the instance on to
        // the next vnode so that it can be properly unmounted later.
        (vnode.patchFlag > 0 || shapeFlag & ShapeFlags.ARRANGABLE || type === Content)
    ) {
        currentBlock.push(vnode)
    }

    return vnode
}

export { createBaseVNode as createElementVNode }

export const createVNode = (
    __DEV__ ? createVNodeWithArgsTransform : _createVNode
) as typeof _createVNode

function _createVNode(
    type: VNodeTypes | ClassArrangable | typeof NULL_DYNAMIC_ARRANGABLE,
    props: (Data & VNodeProps) | null = null,
    children: unknown = null,
    patchFlag: number = 0,
    dynamicProps: string[] | null = null,
    isBlockNode = false,
): VNode {
    if (!type || type === NULL_DYNAMIC_ARRANGABLE) {
        if (__DEV__ && !type) {
            warn(`Invalid vnode type when creating vnode: ${type}.`)
        }
        type = Comment
    }

    if (isVNode(type)) {
        // createVNode receiving an existing vnode. This happens in cases like
        // <arrangable :is="vnode"/>
        // #2078 make sure to merge refs during the clone instead of overwriting it
        const cloned = cloneVNode(type, props)
        if (children) {
            normalizeChildren(cloned, children)
        }
        if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
            if (cloned.shapeFlag & ShapeFlags.ARRANGABLE) {
                currentBlock[currentBlock.indexOf(type)] = cloned
            } else {
                currentBlock.push(cloned)
            }
        }
        cloned.patchFlag = PatchFlags.BAIL
        return cloned
    }

    // class arrangable normalization.
    if (isClassArrangable(type)) {
        type = type.__vccOpts
    }

    // 2.x async/functional arrangable compat

    // Native props keep their original values; only clone reactive input records.
    if (props) props = guardReactiveProps(props)!

    // encode the vnode type information into a bitmap
    const shapeFlag = type === LayoutInvocation
        ? ShapeFlags.LAYOUT_INVOCATION
        : isObject(type)
                    ? ShapeFlags.STATEFUL_ARRANGABLE
                    : isFunction(type)
                        ? ShapeFlags.FUNCTIONAL_ARRANGABLE
                        : 0

    if (__DEV__ && shapeFlag & ShapeFlags.STATEFUL_ARRANGABLE && isProxy(type)) {
        type = toRaw(type)
        warn(
            `Vue received a Arrangable that was made a reactive object. This can ` +
            `lead to unnecessary performance overhead and should be avoided by ` +
            `marking the arrangable with \`markRaw\` or using \`shallowRef\` ` +
            `instead of \`ref\`.`,
            `\nArrangable that was made reactive: `,
            type,
        )
    }

    return createBaseVNode(
        type,
        props,
        children,
        patchFlag,
        dynamicProps,
        shapeFlag,
        isBlockNode,
        true,
    )
}

export function guardReactiveProps(
    props: (Data & VNodeProps) | null,
): (Data & VNodeProps) | null {
    if (!props) return null
    return isProxy(props) || isInternalObject(props) ? extend({}, props) : props
}

export function cloneVNode<T, U>(
    vnode: VNode<T, U>,
    extraProps?: (Data & VNodeProps) | null,
): VNode<T, U> {
    // This is intentionally NOT using spread or extend to avoid the runtime
    // key enumeration cost.
    const { props, patchFlag, children } = vnode
    const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props
    const cloned: VNode<T, U> = {
        __v_isVNode: true,
        __v_skip: true,
        type: vnode.type,
        props: mergedProps,
        valueSources: vnode.valueSources && Object.fromEntries(Object.entries(vnode.valueSources).filter(([key]) => !extraProps || !(key in extraProps))),
        key: mergedProps && normalizeKey(mergedProps),
        content: vnode.content,
        contentScope: vnode.contentScope,
        children:
            __DEV__ && patchFlag === PatchFlags.CACHED && isArray(children)
                ? (children as VNode[]).map(deepCloneVNode)
                : children,
        staticCount: vnode.staticCount,
        shapeFlag: vnode.shapeFlag,
        // if the vnode is cloned with extra props, we can no longer assume its
        // existing patch flag to be reliable and need to add the FULL_PROPS flag.
        // note: preserve flag for fragments since they use the flag for children
        // fast paths only.
        patchFlag:
            extraProps && vnode.type !== Fragment
                ? patchFlag === PatchFlags.CACHED // hoisted node
                    ? PatchFlags.FULL_PROPS
                    : patchFlag | PatchFlags.FULL_PROPS
                : patchFlag,
        dynamicProps: vnode.dynamicProps,
        dynamicChildren: vnode.dynamicChildren,
        appContext: vnode.appContext,
        retention: vnode.retention,
        // These should technically only be non-null on mounted VNodes. However,
        // they *should* be copied for kept-alive vnodes. So we just always copy
        // them since them being non-null during a mount doesn't affect the logic as
        // they will simply be overwritten.
        arrangable: vnode.arrangable,
        el: vnode.el,
        anchor: vnode.anchor,
        ctx: vnode.ctx,
    }

    return cloned
}

/**
 * Dev only, for HMR of hoisted vnodes reused in v-for
 * https://github.com/vitejs/vite/issues/2022
 */
function deepCloneVNode(vnode: VNode): VNode {
    const cloned = cloneVNode(vnode)
    if (isArray(vnode.children)) {
        cloned.children = (vnode.children as VNode[]).map(deepCloneVNode)
    }
    return cloned
}

/**
 * @private
 */
export function createCommentVNode(
    text: string = '',
    // when used as the v-else branch, the comment node must be created as a
    // block to ensure correct updates.
    asBlock: boolean = false,
): VNode {
    return asBlock
        ? (openBlock(), createBlock(Comment, null, text))
        : createVNode(Comment, null, text)
}

export function normalizeVNode(child: VNodeChild): VNode {
    if (child == null || typeof child === 'boolean') {
        // empty placeholder
        return createVNode(Comment)
    } else if (isArray(child)) {
        // fragment
        return createVNode(
            Fragment,
            null,
            // #3666, avoid reference pollution when reusing vnode
            child.slice(),
        )
    } else if (isVNode(child)) {
        // already vnode, this should be the most common since compiled templates
        // always produce all-vnode children arrays
        return cloneIfMounted(child)
    } else {
        throw new TypeError('内容只能包含 Arrangable 调用；显示文字请显式使用 Text 的 text 参数')
    }
}

// optimized normalization for template-compiled render fns
export function cloneIfMounted(child: VNode): VNode {
    return (child.el === null && child.patchFlag !== PatchFlags.CACHED)
        ? child
        : cloneVNode(child)
}

export function normalizeChildren(vnode: VNode, children: unknown): void {
    let type = 0
    const { shapeFlag } = vnode
    if (children == null) {
        children = null
    } else if (isArray(children)) {
        type = ShapeFlags.ARRAY_CHILDREN
    } else if (typeof children === 'object') {
        if (shapeFlag & ShapeFlags.LAYOUT_INVOCATION) {
            // 布局调用的内容进入明确子结构
            const slot = (children as any).default
            if (slot) {
                // _c marker is added by withCtx() indicating this is a compiled slot
                slot._c && (slot._d = false)
                normalizeChildren(vnode, slot())
                slot._c && (slot._d = true)
            }
            return
        } else {
            type = ShapeFlags.SLOTS_CHILDREN
            const slotFlag = (children as RawSlots)._
            if (!slotFlag && !isInternalObject(children)) {
                // if slots are not normalized, attach context instance
                // (compiled / normalized slots already have context)
                ; (children as RawSlots)._ctx = currentRenderingInstance
            } else if (slotFlag === SlotFlags.FORWARDED && currentRenderingInstance) {
                // a child arrangable receives forwarded slots from the parent.
                // its slot type is determined by its parent's slot type.
                if (
                    (currentRenderingInstance.slots as RawSlots)._ === SlotFlags.STABLE
                ) {
                    ; (children as RawSlots)._ = SlotFlags.STABLE
                } else {
                    ; (children as RawSlots)._ = SlotFlags.DYNAMIC
                    vnode.patchFlag |= PatchFlags.DYNAMIC_SLOTS
                }
            }
        }
    } else if (isFunction(children)) {
        children = { default: children, _ctx: currentRenderingInstance }
        type = ShapeFlags.SLOTS_CHILDREN
    } else {
        if (vnode.type !== Comment || typeof children !== 'string') throw new TypeError('内容不能自动转换为文字；请显式使用 Text 的 text 参数')
    }

    vnode.children = children as VNodeNormalizedChildren
    vnode.shapeFlag |= type
}

export function mergeProps(...args: (Data & VNodeProps)[]): Data {
    const result: Data = Object.create(null)
    for (const source of args) {
        if (source == null || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('参数对象必须是普通对象')
        for (const original of Object.keys(source)) {
            const key = camelize(original)
            if (!key) throw new TypeError('参数名称不能为空')
            if (hasOwn(result, key)) throw new TypeError(`重复参数：${key}`)
            result[key] = source[original]
        }
    }
    return result
}
