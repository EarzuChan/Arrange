import { isRef, isReadonly, shallowReactive, shallowReadonly } from '@arrange/vue-reactivity'
import { EMPTY_OBJ, type IfAny, arrangeParameterName, camelize, normalizeParameterObject, hasOwn, isArray, isFunction, isObject } from '@arrange/vue-shared'
import type { AppContext } from './apiCreateApp.ts'
import { type ArrangableInstance, type ConcreteArrangable, type Data, setCurrentInstance } from './arrangable.ts'
import { normalizeDeclaredProps, preparedParameters } from './propDeclarations.ts'
import { arrangeExecutionStats } from './executionStats.ts'

export type ArrangablePropsOptions<P = Data> =
    | ArrangableObjectPropsOptions<P>
    | string[]

export type ArrangableObjectPropsOptions<P = Data> = {
    [K in keyof P]: Prop<P[K]> | null
}

export type Prop<T, D = T> = PropOptions<T, D> | PropType<T>

type DefaultFactory<T> = (props: Data) => T | null | undefined

export interface PropOptions<T = any, D = T> {
    refKind?: 'writable' | 'readonly'
    type?: PropType<T> | true | null
    required?: boolean
    default?: D | DefaultFactory<D> | null | undefined | object
    validator?(value: unknown, props: Data): boolean
    /**
     * @internal
     */
    /**
     * @internal
     */
    skipFactory?: boolean
}

export type PropType<T> = PropConstructor<T> | (PropConstructor<T> | null)[]

type PropConstructor<T = any> =
    | { new(...args: any[]): T & {} }
    | { (): T }
    | BigIntConstructor
    | PropMethod<T>

type PropMethod<T, TConstructor = any> = [T] extends [
    ((...args: any) => any) | undefined,
] // if is function with args, allowing non-required functions
    ? { new(): TConstructor; (): T; readonly prototype: TConstructor } // Create Function like constructor
    : never

type RequiredKeys<T> = {
    [K in keyof T]: T[K] extends
    | { required: true }
    | { default: any }
    ? T[K] extends { default: undefined | (() => undefined) }
    ? never
    : K
    : never
}[keyof T]

type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>

type DefaultKeys<T> = { [K in keyof T]: T[K] extends { default: any } ? K : never }[keyof T]

type InferPropType<T, NullAsAny = true> = [T] extends [null]
    ? NullAsAny extends true
    ? any
    : null
    : [T] extends [{ type: null | true }]
    ? any // As TS issue https://github.com/Microsoft/TypeScript/issues/14829 // somehow `ObjectConstructor` when inferred from { (): T } becomes `any` // `BooleanConstructor` when inferred from PropConstructor(with PropMethod) becomes `Boolean`
    : [T] extends [ObjectConstructor | { type: ObjectConstructor }]
    ? Record<string, any>
    : [T] extends [BooleanConstructor | { type: BooleanConstructor }]
    ? boolean
    : [T] extends [DateConstructor | { type: DateConstructor }]
    ? Date
    : [T] extends [(infer U)[] | { type: (infer U)[] }]
    ? U extends DateConstructor
    ? Date | InferPropType<U, false>
    : InferPropType<U, false>
    : [T] extends [Prop<infer V, infer D>]
    ? unknown extends V
    ? keyof V extends never
    ? IfAny<V, V, D>
    : V
    : V
    : T

/**
 * Extract prop types from a runtime props options object.
 * The extracted types are **internal** - i.e. the resolved props received by
 * the arrangable.
 * - Boolean props are always present
 * - Props with default values are always present
 *
 * To extract accepted props from the parent, use {@link ExtractPublicPropTypes}.
 */
export type ExtractPropTypes<O> = {
    // use `keyof Pick<O, RequiredKeys<O>>` instead of `RequiredKeys<O>` to
    // support IDE features
    [K in keyof Pick<O, RequiredKeys<O>>]: O[K] extends { default: any }
    ? Exclude<InferPropType<O[K]>, undefined>
    : InferPropType<O[K]>
} & {
    // use `keyof Pick<O, OptionalKeys<O>>` instead of `OptionalKeys<O>` to
    // support IDE features
    [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>
}

type PublicRequiredKeys<T> = {
    [K in keyof T]: T[K] extends { required: true } ? K : never
}[keyof T]

type PublicOptionalKeys<T> = Exclude<keyof T, PublicRequiredKeys<T>>

/**
 * Extract prop types from a runtime props options object.
 * The extracted types are **public** - i.e. the expected props that can be
 * passed to arrangable.
 */
export type ExtractPublicPropTypes<O> = {
    [K in keyof Pick<O, PublicRequiredKeys<O>>]: InferPropType<O[K]>
} & {
    [K in keyof Pick<O, PublicOptionalKeys<O>>]?: InferPropType<O[K]>
}

// 默认值只来自声明，布尔参数不自动补值或转换
export type ExtractDefaultPropTypes<O> = O extends object ? { [K in keyof Pick<O, DefaultKeys<O>>]: InferPropType<O[K]> } : {}
export type NormalizedProps = Record<string, PropOptions>
export type NormalizedPropsOptions = [NormalizedProps, string[]] | []

export function initProps(instance: ArrangableInstance, rawProps: Data | null, _isStateful: number): void {
    instance.propsDefaults = Object.create(null)
    instance.props = shallowReactive(resolveProps(instance, rawProps))
}

export function updateProps(instance: ArrangableInstance, rawProps: Data | null, _rawPrevProps: Data | null, _optimized: boolean): void {
    // 先完整校验，再更新对业务可见的参数，避免错误调用污染旧状态
    const next = resolveProps(instance, rawProps)
    for (const key of Object.keys(instance.props)) if (!hasOwn(next, key)) delete instance.props[key]
    for (const key of Object.keys(next)) instance.props[key] = next[key]
}

function resolveProps(instance: ArrangableInstance, raw: Data | null): Data {
    const declarations = instance.propsOptions[0] ?? EMPTY_OBJ
    const prepared = preparedParameters(raw, instance.type)
    const provided = prepared ? hasOwn(raw!, 'key') ? { ...raw } : raw! : raw == null ? Object.create(null) : normalizeParameterObject(raw)
    if (hasOwn(provided, 'key')) delete provided.key
    if (!prepared) {
        for (const name of Object.keys(provided)) {
            arrangeExecutionStats.parameterNameChecks++
            if (!hasOwn(declarations, name)) {
                const source = instance.vnode.valueSources?.[name]?.source ?? instance.type.__file
                throw new TypeError(`Arrangable ${instance.type.name ?? instance.type.__name ?? ''} 未声明参数：${name}${source ? `\n来源：${source}` : ''}`)
            }
        }
    }

    const resolved: Data = Object.create(null)
    const entries = prepared?.plan.entries ?? Object.entries(declarations).map(([name, declaration]) => ({ name, declaration, position: -1 }))
    for (const { name: key, declaration, position } of entries) {
        let value = prepared ? prepared.values[position] : provided[key]
        const absent = prepared ? position < 0 : !hasOwn(provided, key)
        if (prepared) arrangeExecutionStats.parameterPositionReads++
        if (value === undefined && hasOwn(declaration, 'default')) {
            if (!hasOwn(instance.propsDefaults, key)) {
                const factory = declaration.default
                if (isFunction(factory) && declaration.type !== Function && !declaration.skipFactory) {
                    const restore = setCurrentInstance(instance)
                    const defaultInputs = prepared ? Object.fromEntries(Object.entries(provided).filter(([name]) => name !== 'key')) : provided
                    try { instance.propsDefaults[key] = factory.call(null, defaultInputs) } finally { restore() }
                } else instance.propsDefaults[key] = factory
            }
            value = instance.propsDefaults[key]
        }
        try { validateProp(key, value, declaration, provided, absent) } catch (error) {
            const source = instance.vnode.valueSources?.[key]?.source ?? prepared?.source
            if (error instanceof Error && source && !error.message.includes(source)) error.message += `\n来源：${source}`
            throw error
        }
        resolved[key] = value
    }
    return resolved
}

export function normalizePropsOptions(definition: ConcreteArrangable, context: AppContext): NormalizedPropsOptions {
    const cached = context.propsCache.get(definition)
    if (cached) return cached
    const declarations = normalizeDeclaredProps(definition.props)
    const normalized: NormalizedPropsOptions = [declarations, []]
    context.propsCache.set(definition, normalized)
    return normalized
}

function validateProp(name: string, value: unknown, declaration: PropOptions, props: Data, absent: boolean): void {
    if (absent && declaration.required && !hasOwn(declaration, 'default')) throw new TypeError(`缺少必需参数：${name}`)
    if (value === undefined && !declaration.required) return
    if (declaration.refKind && (!isRef(value) || declaration.refKind === 'writable' && isReadonly(value))) throw new TypeError(`参数 ${name} 要求${declaration.refKind === 'writable' ? '可写' : '只读'} Ref 本体`)
    const { type, validator } = declaration
    if (type != null && type !== true) {
        const types = isArray(type) ? type : [type]
        if (!types.some(candidate => matchesType(value, candidate))) throw new TypeError(`参数 ${name} 类型错误：要求 ${types.map(candidate => candidate?.name ?? 'null').join(' | ')}`)
    }
    if (validator && !validator(value, shallowReadonly(props))) throw new TypeError(`参数 ${name} 未通过声明校验`)
}

function matchesType(value: unknown, type: PropConstructor | null): boolean {
    if (type === null) return value === null
    switch (type) {
        case String: return typeof value === 'string'
        case Number: return typeof value === 'number'
        case Boolean: return typeof value === 'boolean'
        case Function: return typeof value === 'function'
        case Symbol: return typeof value === 'symbol'
        case BigInt: return typeof value === 'bigint'
        case Object: return value !== null && typeof value === 'object' && !isArray(value)
        case Array: return isArray(value)
        default: return value instanceof type
    }
}
