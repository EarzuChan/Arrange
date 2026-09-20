import type { DefineArrangable } from './apiDefineArrangable.ts'
import type { Arrangable, Data } from './arrangable.ts'
import type { ArrangableObjectPropsOptions, ExtractDefaultPropTypes, ExtractPropTypes } from './arrangableProps.ts'
import type { Slot, Slots } from './arrangableSlots.ts'
import { normalizeDeclaredProps } from './propDeclarations.ts'
import type { VNode, VNodeChild } from './vnode.ts'
import type { ValueExpression } from './valueBinding.ts'

type DefinitionInputs<D> = D extends new (...args: any[]) => { $props: infer P } ? { [K in keyof P]: P[K] | ValueExpression<P[K]> } : Data

export type FoundationArrangable<P extends ArrangableObjectPropsOptions, Names extends readonly string[]> = DefineArrangable<ExtractPropTypes<P>, {}, ExtractDefaultPropTypes<P>> & { readonly props: P; readonly slotNames: Names }

export interface FoundationContext<P, Names extends readonly string[]> {
    readonly props: Readonly<P>
    call<D extends Arrangable>(definition: D, inputs: DefinitionInputs<D>, slots?: Slots): VNode
    slot(name: Names[number]): Slot | undefined
    content(name: Names[number], key?: PropertyKey): VNode
    source(name: keyof P & string): string | undefined
}

export interface FoundationDefinition<P extends ArrangableObjectPropsOptions, Names extends readonly string[]> {
    readonly name: string
    readonly props: P
    readonly slotNames: Names
    readonly implement: (context: FoundationContext<ExtractPropTypes<P>, Names>) => VNodeChild
}

// 类型参数只在注册边界擦除，声明、实现与调用身份仍保留在同一份定义中
type RegisteredFoundation = {
    readonly name: string
    readonly slotNames: readonly string[]
    readonly implement: (context: FoundationContext<Data, readonly string[]>) => VNodeChild
}

const definitions = new WeakMap<object, RegisteredFoundation>()
export function defineFoundationArrangable<const P extends ArrangableObjectPropsOptions, const Names extends readonly string[]>(definition: FoundationDefinition<P, Names>): FoundationArrangable<P, Names> {
    if (!definition || typeof definition !== 'object') throw new TypeError('Foundation 定义必须是对象')

    for (const key of Object.keys(definition)) if (!['name', 'props', 'slotNames', 'implement'].includes(key)) throw new TypeError(`Foundation 定义不接受 ${key}`)

    if (typeof definition.name !== 'string' || !definition.name || typeof definition.implement !== 'function') throw new TypeError('Foundation 必须明确声明名称和 implement 实现')

    if (!definition.props || Array.isArray(definition.props)) throw new TypeError('Foundation 必须逐项声明参数')

    normalizeDeclaredProps(definition.props)

    if (!Array.isArray(definition.slotNames) || definition.slotNames.some(name => typeof name !== 'string' || !name) || new Set(definition.slotNames).size !== definition.slotNames.length) throw new TypeError('Foundation 必须声明不重复的内容入口')

    const props = Object.fromEntries(Object.entries(definition.props).map(([name, value]) => {
        if (Array.isArray(value)) return [name, Object.freeze([...value])]

        if (!value || typeof value !== 'object') return [name, value]

        return [name, Object.freeze(Array.isArray(value.type) ? { ...value, type: Object.freeze([...value.type]) } : { ...value })]
    }))

    const registered = Object.freeze({ ...definition, props: Object.freeze(props), slotNames: Object.freeze([...definition.slotNames]) })

    definitions.set(registered, registered as unknown as RegisteredFoundation)

    return registered as unknown as FoundationArrangable<P, Names>
}

export function isFoundationArrangable(value: unknown): boolean {
    return typeof value === 'object' && value !== null && definitions.has(value)
}

export function getFoundationDefinition(value: object): RegisteredFoundation | undefined {
    return definitions.get(value)
}
