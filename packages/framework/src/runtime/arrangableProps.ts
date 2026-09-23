import {batchUpdates, isRef, isReadonly, shallowReadonly, shallowRef, pauseTracking, resetTracking, type ShallowRef} from '@arrange/reactivity'
import {type IfAny, hasOwn, isArray} from '@arrange/shared'
import type {ArrangableInstance, CallMetadata, Data} from './arrangable.ts'
import {checkParameterPlan, normalizeDeclaredProps, prepareParameters} from './propDeclarations.ts'
import {arrangeExecutionStats} from './executionStats.ts'
import {ValueBinding} from './valueBinding.ts'
import {queueJob, SchedulerJobFlags, type SchedulerJob} from './scheduler.ts'
import {callWithErrorHandling, ErrorCodes} from './errorHandling.ts'

export type ArrangablePropsOptions<P = Data> = | ArrangableObjectPropsOptions<P> | string[]

export type ArrangableObjectPropsOptions<P = Data> = { [K in keyof P]: Prop<P[K]> | null }

export type Prop<T, D = T> = PropOptions<T, D> | PropType<T>

type DefaultFactory<T> = (props: Data) => T | null | undefined

export interface PropOptions<T = any, D = T> {
    refKind?: 'writable' | 'readonly'
    type?: PropType<T> | true | null
    required?: boolean
    default?: D | DefaultFactory<D> | null | undefined | object

    validator?(value: unknown, props: Data): boolean

    skipFactory?: boolean // 内部
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
    [K in keyof T]: T[K] extends | { required: true }
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
export type ExtractPublicPropTypes<O> = { [K in keyof Pick<O, PublicRequiredKeys<O>>]: InferPropType<O[K]> } & { [K in keyof Pick<O, PublicOptionalKeys<O>>]?: InferPropType<O[K]> }

// 默认值只来自声明，布尔参数不自动补值或转换
export type ExtractDefaultPropTypes<O> = O extends object ? { [K in keyof Pick<O, DefaultKeys<O>>]: InferPropType<O[K]> } : {}
export type NormalizedProps = Record<string, PropOptions>
export type NormalizedPropsOptions = [NormalizedProps, string[]] | []

export type PropGetter<T> = () => T
export type PropInputs<P> = { readonly [K in keyof P]: PropGetter<P[K]> }

export class PropStore {
    readonly values: Data = Object.create(null)
    private readonly cells = new Map<string, ShallowRef<unknown>>()
    private readonly bindings = new Map<string, ValueBinding>()
    private readonly defaults = new Map<string, unknown>()
    private readonly pending = new Map<string, unknown>()
    private absent = new Set<string>()
    private readonly job: SchedulerJob
    private readonly refreshDirty = () => {
        this.preserve()
        for (const binding of this.bindings.values()) binding.refreshDirty()
        this.publishValues()
    }
    private readonly updateTask = {scope: () => this.owner.structure, dirty: () => !this.owner.isUnmounted && !this.owner.isDeactivated && [...this.bindings.values()].some(binding => binding.dirty), run: this.refreshDirty}
    private readonly declarations: NormalizedProps
    private constants = new Set<string>()
    private inputs: PropInputs<Data> | undefined
    private sources: Readonly<Record<string, string | undefined>> = {}

    constructor(private readonly owner: ArrangableInstance) {
        this.declarations = normalizeDeclaredProps(owner.type.props)
        this.job = () => {
            if (!owner.isUnmounted && !owner.isDeactivated) callWithErrorHandling(() => owner.rearrangeSession.runValue(this.updateTask), owner, ErrorCodes.ARRANGABLE_UPDATE)
        }
        this.job.i = owner
        for (const name of Object.keys(this.declarations)) {
            const cell = shallowRef<unknown>()
            this.cells.set(name, cell)
            Object.defineProperty(this.values, name, {enumerable: true, get: () => cell.value})
        }
        Object.freeze(this.values)
    }

    private preserve(): void {
        this.owner.rearrangeSession.preserve(this, () => {
            const inputs = this.inputs
            const values = new Map([...this.cells].map(([name, cell]) => [name, cell.value]))
            const defaults = new Map(this.defaults)
            const constants = this.constants
            const sources = this.sources
            const absent = this.absent
            return () => {
                this.inputs = inputs
                this.pending.clear()
                this.defaults.clear()
                for (const [name, value] of defaults) this.defaults.set(name, value)
                this.constants = constants
                this.sources = sources
                this.absent = absent
                batchUpdates(() => {
                    for (const [name, value] of values) this.cells.get(name)!.value = value
                })
            }
        })
    }

    private publishValues(): void {
        if (!this.pending.size) return
        const values = Object.fromEntries([...this.cells].map(([name, cell]) => [name, this.pending.has(name) ? this.pending.get(name) : cell.value]))
        for (const [name, declaration] of Object.entries(this.declarations)) try {
            validateProp(name, values[name], declaration, values, this.absent.has(name))
        } catch (error) {
            const source = this.source(name)
            if (error instanceof Error) error.message += `\nArrangable：${this.owner.type.name ?? this.owner.type.__name ?? '匿名定义'}${source ? `\n来源：${source}` : ''}`
            throw error
        }
        const pending = [...this.pending]
        this.pending.clear()
        batchUpdates(() => {
            for (const [name, value] of pending) this.cells.get(name)!.value = value
        })
    }

    private invalidate = (): void => {
        if (this.owner.rearrangeSession.reverting) return
        if (this.owner.rearrangeSession.preparing) this.owner.rearrangeSession.runValue(this.updateTask)
        else queueJob(this.job)
    }

    source(name: string): string | undefined {
        return this.sources[name] ?? this.owner.source ?? this.owner.type.__file
    }

    invalidateConstants(): void {
        if (!this.constants.size) return
        this.preserve()
        this.constants.clear()
    }

    update(inputs: Record<string, PropGetter<unknown>>, metadata: CallMetadata = {}): void {
        if (metadata.parameters) checkParameterPlan(metadata.parameters, this.owner.type)
        if (inputs === this.inputs && Object.isFrozen(inputs)) {
            this.refreshDirty()
            return
        }
        const plan = metadata.parameters ?? prepareParameters(this.owner.type, Object.keys(inputs), [], metadata.source)
        const entries = Object.entries(inputs)
        if (entries.length !== plan.names.length) throw new TypeError('参数组与声明位置计划不一致')
        const getters = entries.map(([name, getter], index) => {
            if (name !== plan.names[index]) throw new TypeError(`参数组与声明位置计划不一致：${name}`)
            if (typeof getter !== 'function') throw new TypeError(`内部参数 ${name} 必须提供求值函数`)
            return getter
        })

        this.preserve()
        this.inputs = inputs
        this.sources = metadata.sources ?? {}
        this.absent = new Set(plan.fields.filter(field => field.position < 0).map(field => field.name))
        const nextConstants = new Set(metadata.constants ?? [])
        pauseTracking()
        try {
            for (const {name, position} of plan.fields) {
                const declaration = this.declarations[name]
                if (this.constants.has(name) && nextConstants.has(name)) continue
                const read = () => {
                    if (position >= 0) arrangeExecutionStats.parameterPositionReads++
                    let value = position < 0 ? undefined : getters[position]()
                    if (value === undefined && hasOwn(declaration, 'default')) {
                        if (!this.defaults.has(name)) {
                            const factory = declaration.default
                            this.defaults.set(name, typeof factory === 'function' && declaration.type !== Function && !declaration.skipFactory ? factory(this.values) : factory)
                        }
                        value = this.defaults.get(name)
                    }
                    return value
                }
                const existing = this.bindings.get(name)
                if (existing) existing.refresh(read, this.source(name))
                else this.bindings.set(name, new ValueBinding(read, this.owner, value => this.pending.set(name, value), this.source(name), this.invalidate))
            }

            this.constants = nextConstants
            this.publishValues()
        } finally {
            resetTracking()
        }
    }

    stop(): void {
        this.job.flags = (this.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
        for (const binding of this.bindings.values()) binding.stop()
        this.bindings.clear()
    }
}

function validateProp(name: string, value: unknown, declaration: PropOptions, props: Data, absent: boolean): void {
    if (absent && declaration.required && !hasOwn(declaration, 'default')) throw new TypeError(`缺少必需参数：${name}`)
    if (value === undefined && !declaration.required) return
    if (declaration.refKind && (!isRef(value) || declaration.refKind === 'writable' && isReadonly(value))) throw new TypeError(`参数 ${name} 要求${declaration.refKind === 'writable' ? '可写' : '只读'} Ref 本体`)
    const {type, validator} = declaration
    if (type != null && type !== true) {
        const types = isArray(type) ? type : [type]
        if (!types.some(candidate => matchesType(value, candidate))) throw new TypeError(`参数 ${name} 类型错误：要求 ${types.map(candidate => candidate?.name ?? 'null').join(' | ')}，实际为 ${value === null ? 'null' : isArray(value) ? 'Array' : typeof value}`)
    }
    if (validator && !validator(value, shallowReadonly(props))) throw new TypeError(`参数 ${name} 未通过声明校验`)
}

function matchesType(value: unknown, type: PropConstructor | null): boolean {
    if (type === null) return value === null

    switch (type) {
        case String:
            return typeof value === 'string'

        case Number:
            return typeof value === 'number'

        case Boolean:
            return typeof value === 'boolean'

        case Function:
            return typeof value === 'function'

        case Symbol:
            return typeof value === 'symbol'

        case BigInt:
            return typeof value === 'bigint'

        case Object:
            return value !== null && typeof value === 'object' && !isArray(value)

        case Array:
            return isArray(value)

        default:
            return value instanceof type
    }
}
