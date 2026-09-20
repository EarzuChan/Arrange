import { shallowReadonly } from '@arrange/vue-reactivity'
import {
    PatchFlags,
    ShapeFlags,
} from '@arrange/vue-shared'
import {
    type ArrangableInstance,
    type Data,
    type FunctionalArrangable
} from './arrangable.ts'
import type { NormalizedProps } from './arrangableProps.ts'
import { setCurrentRenderingInstance } from './arrangableRenderContext.ts'
import type { RawSlots } from './arrangableSlots.ts'
import { ErrorCodes, handleError } from './errorHandling.ts'
import { arrangeExecutionStats } from './executionStats.ts'
import { isHmrUpdating } from './hmr.ts'
import { arrangeValue } from './valueBinding.ts'
import {
    Comment,
    type VNode,
    type VNodeArrayChildren,
    blockStack,
    cloneVNode,
    createVNode,
    isVNode,
    normalizeVNode,
} from './vnode.ts'
import { warn } from './warning.ts'

type SetRootFn = ((root: VNode) => void) | undefined

export function renderArrangableRoot(
    instance: ArrangableInstance,
): VNode {
    arrangeExecutionStats.structureRuns++
    const {
        type: Arrangable,
        vnode,
        proxy,
        propsOptions: [propsOptions],
        slots,
        render,
        renderCache,
        props,
        setupState,
    } = instance
    const prev = setCurrentRenderingInstance(instance)

    let result

    try {
        if (vnode.shapeFlag & ShapeFlags.STATEFUL_ARRANGABLE) {
            // 'this' isn't available in production builds with `<script setup>`,
            // so warn if it's used in dev.
            const thisProxy =
                __DEV__ && setupState.__isScriptSetup
                    ? new Proxy(proxy!, {
                        get(target, key, receiver) {
                            warn(
                                `Property '${String(
                                    key,
                                )}' was accessed via 'this'. Avoid using 'this' in templates.`,
                            )
                            return Reflect.get(target, key, receiver)
                        },
                    })
                    : proxy
            result = normalizeVNode(
                render!.call(
                    thisProxy,
                    proxy!,
                    renderCache,
                    __DEV__ ? shallowReadonly(props) : props,
                    setupState,
                ),
            )
        } else {
            const render = Arrangable as FunctionalArrangable
            result = normalizeVNode(render(shallowReadonly(props), { slots }))
        }
    } catch (err) {
        blockStack.length = 0
        setCurrentRenderingInstance(prev)
        handleError(err, instance, ErrorCodes.RENDER_FUNCTION)
        throw err
    }

    // in dev mode, comments are preserved, and it's possible for a template
    // to have comments along side the root element which makes it a fragment
    let root = result
    let setRoot: SetRootFn = undefined
    if (
        __DEV__ &&
        result.patchFlag > 0 &&
        result.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
    ) {
        ;[root, setRoot] = getChildRoot(result)
    }
    if (__DEV__ && setRoot) {
        setRoot(root)
    } else {
        result = root
    }

    setCurrentRenderingInstance(prev)
    return result
}

/**
 * dev only
 * In dev mode, template root level comments are rendered, which turns the
 * template into a fragment root, but we need to locate the single element
 * root for attrs and scope id processing.
 */
const getChildRoot = (vnode: VNode): [VNode, SetRootFn] => {
    const rawChildren = vnode.children as VNodeArrayChildren
    const dynamicChildren = vnode.dynamicChildren
    const childRoot = filterSingleRoot(rawChildren, false)
    if (!childRoot) {
        return [vnode, undefined]
    } else if (
        __DEV__ &&
        childRoot.patchFlag > 0 &&
        childRoot.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
    ) {
        return getChildRoot(childRoot)
    }

    const index = rawChildren.indexOf(childRoot)
    const dynamicIndex = dynamicChildren ? dynamicChildren.indexOf(childRoot) : -1
    const setRoot: SetRootFn = (updatedRoot: VNode) => {
        rawChildren[index] = updatedRoot
        if (dynamicChildren) {
            if (dynamicIndex > -1) {
                dynamicChildren[dynamicIndex] = updatedRoot
            } else if (updatedRoot.patchFlag > 0) {
                vnode.dynamicChildren = [...dynamicChildren, updatedRoot]
            }
        }
    }
    return [normalizeVNode(childRoot), setRoot]
}

export function filterSingleRoot(
    children: VNodeArrayChildren,
    recurse = true,
): VNode | undefined {
    let singleRoot
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isVNode(child)) {
            // ignore user comment
            if (child.type !== Comment || child.children === 'v-if') {
                if (singleRoot) {
                    // has more than 1 non-comment child, return now
                    return
                } else {
                    singleRoot = child
                    if (
                        __DEV__ &&
                        recurse &&
                        singleRoot.patchFlag > 0 &&
                        singleRoot.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
                    ) {
                        return filterSingleRoot(singleRoot.children as VNodeArrayChildren)
                    }
                }
            }
        } else {
            return
        }
    }
    return singleRoot
}

export function shouldUpdateArrangable(prevVNode: VNode, nextVNode: VNode, optimized?: boolean): boolean {
    const previous = prevVNode.children
    const next = nextVNode.children
    if (__DEV__ && (previous || next) && isHmrUpdating) return true
    if (nextVNode.patchFlag & PatchFlags.DYNAMIC_SLOTS) return true
    if (previous === next) return false
    if (optimized && nextVNode.patchFlag >= 0) return false
    if (previous || next) return !next || !((next as RawSlots)._ === 1 || (next as RawSlots).$stable)
    return false
}

export function updateHOCHostEl(
    { vnode, parent }: ArrangableInstance,
    el: typeof vnode.el, // HostNode
): void {
    while (parent) {
        const root = parent.subTree

        if (root === vnode) {
            ; (vnode = parent.vnode).el = el
            parent = parent.parent
        } else {
            break
        }
    }

}
