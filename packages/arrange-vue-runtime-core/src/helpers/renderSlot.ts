import { contentBranchKey } from '../contentScope.ts'
import type { Slots } from '../arrangableSlots.ts'
import { Comment, Content, Fragment, type VNode, type VNodeArrayChildren, createVNode, isVNode } from '../vnode.ts'

// 内容只记录调用，实际求值属于调用位置独立的结构作用域
export function renderSlot(slots: Slots, name: string, key?: PropertyKey): VNode {
    const identity = key ?? slots[name]?.[contentBranchKey]
    const invocation = createVNode(Content, identity === undefined ? null : { key: identity })
    invocation.content = () => slots[name]?.() ?? []
    return invocation
}

export function ensureValidVNode(
    vnodes: VNodeArrayChildren,
): VNodeArrayChildren | null {
    return vnodes.some(child => {
        if (!isVNode(child)) return true
        if (child.type === Comment) return false
        if (
            child.type === Fragment &&
            !ensureValidVNode(child.children as VNodeArrayChildren)
        )
            return false
        return true
    })
        ? vnodes
        : null
}
