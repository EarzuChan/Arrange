import { type Prettify, SlotFlags, isArray, isFunction } from '@arrange/vue-shared'
import { type ArrangableInstance } from './arrangable.ts'
import { withCtx } from './arrangableRenderContext.ts'
import { contentBranchKey } from './contentScope.ts'
import { createInternalObject } from './internalObject.ts'
import {
    type VNode,
    type VNodeChild,
    type VNodeNormalizedChildren,
    normalizeVNode,
} from './vnode.ts'

// 内容入口没有业务参数，词法变量由提供方闭包捕获
export type Slot<T = unknown> = (() => VNode[]) & { [contentBranchKey]?: PropertyKey }

export type InternalSlots = {
    [name: string]: Slot | undefined
}

export type Slots = Readonly<InternalSlots>

declare const SlotSymbol: unique symbol
export type SlotsType<T extends Record<string, any> = Record<string, any>> = {
    [SlotSymbol]?: T
}

export type StrictUnwrapSlotsType<
    S extends SlotsType,
    T = NonNullable<S[typeof SlotSymbol]>,
> = [keyof S] extends [never] ? Slots : Readonly<T> & T

export type UnwrapSlotsType<
    S extends SlotsType,
    T = NonNullable<S[typeof SlotSymbol]>,
> = [keyof S] extends [never]
    ? Slots
    : Readonly<
        Prettify<{
            [K in keyof T]: NonNullable<T[K]> extends (...args: any[]) => any
            ? T[K]
            : Slot<T[K]>
        }>
    >

export type RawSlots = {
    [name: string]: unknown
    // manual render fn hint to skip forced children updates
    $stable?: boolean
    /**
     * for tracking slot owner instance. This is attached during
     * normalizeChildren when the arrangable vnode is created.
     * @internal
     */
    _ctx?: ArrangableInstance | null
    /**
     * indicates compiler generated slots
     * we use a reserved property instead of a vnode patchFlag because the slots
     * object may be directly passed down to a child arrangable in a manual
     * render function, and the optimization hint need to be on the slot object
     * itself to be preserved.
     * @internal
     */
    _?: SlotFlags
}

const isInternalKey = (key: string) => key === '_' || key === '_ctx' || key === '$stable'

function resolveSlots(instance: ArrangableInstance, children: VNodeNormalizedChildren): InternalSlots {
    const slots: InternalSlots = createInternalObject()
    if (children == null) return slots
    if (isArray(children) || typeof children !== 'object') throw new TypeError('Arrangable 内容必须通过无参数内容入口提供')

    const declarations = new Set(instance.type.slotNames ?? [])
    const raw = children as RawSlots
    for (const name of Object.keys(raw)) {
        if (isInternalKey(name)) continue
        if (!declarations.has(name)) throw new TypeError(`Arrangable ${instance.type.name ?? instance.type.__name ?? ''} 未声明内容入口：${name}`)
        const content = raw[name]
        if (!isFunction(content)) throw new TypeError(`内容入口 ${name} 必须是无参数函数`)
        slots[name] = withCtx(() => {
            const result: unknown = content()
            return (isArray(result) ? result : [result]).map(value => normalizeVNode(value as VNodeChild))
        }, raw._ctx) as Slot
        slots[name]![contentBranchKey] = (content as Slot)[contentBranchKey]
    }
    return slots
}

export function initSlots(instance: ArrangableInstance, children: VNodeNormalizedChildren, _optimized: boolean): void {
    instance.slots = resolveSlots(instance, children)
}

export function updateSlots(instance: ArrangableInstance, children: VNodeNormalizedChildren, _optimized: boolean): void {
    const next = resolveSlots(instance, children)
    for (const key of Object.keys(instance.slots)) if (!(key in next)) delete instance.slots[key]
    Object.assign(instance.slots, next)
}
