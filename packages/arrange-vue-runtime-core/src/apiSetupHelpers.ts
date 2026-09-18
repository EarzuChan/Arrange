import type { Ref } from '@arrange/vue-reactivity'
import {
    type IfAny,
    type LooseRequired,
    type Prettify,
    type UnionToIntersection,
    extend,
    isArray,
    isFunction,
    isPromise,
} from '@arrange/vue-shared'
import {
    type SetupContext,
    createSetupContext,
    getCurrentInstance,
    setCurrentInstance,
    unsetCurrentInstance,
} from './component.ts'
import type { EmitFn, EmitsOptions, ObjectEmitsOptions } from './componentEmits.ts'
import type { ComponentOptionsBase } from './componentOptions.ts'
import type {
    ComponentObjectPropsOptions,
    ComponentPropsOptions,
    ExtractPropTypes,
    PropOptions,
} from './componentProps.ts'
import type { SlotsType, StrictUnwrapSlotsType } from './componentSlots.ts'
import { warn } from './warning.ts'

// dev only
const warnRuntimeUsage = (method: string) =>
    warn(
        `${method}() is a compiler-hint helper that is only usable inside ` +
        `<script setup> of a single file component. Its arguments should be ` +
        `compiled away and passing it at runtime has no effect.`,
    )

// overload 1: runtime props w/ array
export function defineProps<PropNames extends string = string>(
    props: PropNames[],
): Prettify<Readonly<{ [key in PropNames]?: any }>>
// overload 2: runtime props w/ object
export function defineProps<
    PP extends ComponentObjectPropsOptions = ComponentObjectPropsOptions,
>(props: PP): Prettify<Readonly<ExtractPropTypes<PP>>>
// overload 3: typed-based declaration
export function defineProps<TypeProps>(): DefineProps<
    LooseRequired<TypeProps>,
    BooleanKey<TypeProps>
>
// implementation
export function defineProps() {
    if (__DEV__) {
        warnRuntimeUsage(`defineProps`)
    }
    return null as any
}

export type DefineProps<T, BKeys extends keyof T> = Readonly<T> & {
    readonly [K in BKeys]-?: boolean
}

type BooleanKey<T, K extends keyof T = keyof T> = K extends any
    ? T[K] extends boolean | undefined
    ? T[K] extends never | undefined
    ? never
    : K
    : never
    : never

// overload 1: runtime emits w/ array
export function defineEmits<EE extends string = string>(
    emitOptions: EE[],
): EmitFn<EE[]>
export function defineEmits<E extends EmitsOptions = EmitsOptions>(
    emitOptions: E,
): EmitFn<E>
export function defineEmits<T extends ComponentTypeEmits>(): T extends (
    ...args: any[]
) => any
    ? T
    : ShortEmits<T>
// implementation
export function defineEmits() {
    if (__DEV__) {
        warnRuntimeUsage(`defineEmits`)
    }
    return null as any
}

export type ComponentTypeEmits = ((...args: any[]) => any) | Record<string, any>

type RecordToUnion<T extends Record<string, any>> = T[keyof T]

type ShortEmits<T extends Record<string, any>> = UnionToIntersection<
    RecordToUnion<{
        [K in keyof T]: (evt: K, ...args: T[K]) => void
    }>
>

export function defineExpose<
    Exposed extends Record<string, any> = Record<string, any>,
>(exposed?: Exposed): void {
    if (__DEV__) {
        warnRuntimeUsage(`defineExpose`)
    }
}

export function defineOptions(options?: Pick<ComponentOptionsBase, 'name' | 'inheritAttrs' | 'components' | 'directives'>): void {
    if (__DEV__) warnRuntimeUsage('defineOptions')
}

export function defineSlots<
    S extends Record<string, any> = Record<string, any>,
>(): StrictUnwrapSlotsType<SlotsType<S>> {
    if (__DEV__) {
        warnRuntimeUsage(`defineSlots`)
    }
    return null as any
}

export type ModelRef<T, M extends PropertyKey = string, G = T, S = T> = Ref<
    G,
    S
> &
[ModelRef<T, M, G, S>, Record<M, true | undefined>]

export type DefineModelOptions<T = any, G = T, S = T> = {
    get?: (v: T) => G
    set?: (v: S) => any
}

/**
 * Vue `<script setup>` compiler macro for declaring a
 * two-way binding prop that can be consumed via `v-model` from the parent
 * component. This will declare a prop with the same name and a corresponding
 * `update:propName` event.
 *
 * If the first argument is a string, it will be used as the prop name;
 * Otherwise the prop name will default to "modelValue". In both cases, you
 * can also pass an additional object which will be used as the prop's options.
 *
 * The returned ref behaves differently depending on whether the parent
 * provided the corresponding v-model props or not:
 * - If yes, the returned ref's value will always be in sync with the parent
 *   prop.
 * - If not, the returned ref will behave like a normal local ref.
 *
 * @example
 * ```ts
 * // default model (consumed via `v-model`)
 * const modelValue = defineModel<string>()
 * modelValue.value = "hello"
 *
 * // default model with options
 * const modelValue = defineModel<string>({ required: true })
 *
 * // with specified name (consumed via `v-model:count`)
 * const count = defineModel<number>('count')
 * count.value++
 *
 * // with specified name and default value
 * const count = defineModel<number>('count', { default: 0 })
 * ```
 */
export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
    options: ({ default: any } | { required: true }) &
        PropOptions<T> &
        DefineModelOptions<T, G, S>,
): ModelRef<T, M, G, S>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
    options?: PropOptions<T> & DefineModelOptions<T, G, S>,
): ModelRef<T | undefined, M, G | undefined, S | undefined>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
    name: string,
    options: ({ default: any } | { required: true }) &
        PropOptions<T> &
        DefineModelOptions<T, G, S>,
): ModelRef<T, M, G, S>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
    name: string,
    options?: PropOptions<T> & DefineModelOptions<T, G, S>,
): ModelRef<T | undefined, M, G | undefined, S | undefined>

export function defineModel(): any {
    if (__DEV__) {
        warnRuntimeUsage('defineModel')
    }
}

type NotUndefined<T> = T extends undefined ? never : T
type MappedOmit<T, K extends keyof any> = {
    [P in keyof T as P extends K ? never : P]: T[P]
}

type InferDefaults<T> = {
    [K in keyof T]?: InferDefault<T, T[K]>
}

type NativeType =
    | null
    | undefined
    | number
    | string
    | boolean
    | symbol
    | Function

type InferDefault<P, T> =
    | ((props: P) => T & {})
    | (T extends NativeType ? T : never)

type PropsWithDefaults<
    T,
    Defaults extends InferDefaults<T>,
    BKeys extends keyof T,
> = T extends unknown
    ? Readonly<MappedOmit<T, keyof Defaults>> & {
        readonly [K in keyof Defaults as K extends keyof T
        ? K
        : never]-?: K extends keyof T
        ? Defaults[K] extends undefined
        ? IfAny<Defaults[K], NotUndefined<T[K]>, T[K]>
        : NotUndefined<T[K]>
        : never
    } & {
        readonly [K in BKeys]-?: K extends keyof Defaults
        ? Defaults[K] extends undefined
        ? boolean | undefined
        : boolean
        : boolean
    }
    : never

export function withDefaults<
    T,
    BKeys extends keyof T,
    Defaults extends InferDefaults<T>,
>(
    props: DefineProps<T, BKeys>,
    defaults: Defaults,
): PropsWithDefaults<T, Defaults, BKeys> {
    if (__DEV__) {
        warnRuntimeUsage(`withDefaults`)
    }
    return null as any
}

export function useSlots(): SetupContext['slots'] {
    return getContext('useSlots').slots
}

export function useAttrs(): SetupContext['attrs'] {
    return getContext('useAttrs').attrs
}

function getContext(calledFunctionName: string): SetupContext {
    const i = getCurrentInstance()!
    if (__DEV__ && !i) {
        warn(`${calledFunctionName}() called without active instance.`)
    }
    return i.setupContext || (i.setupContext = createSetupContext(i))
}

/**
 * @internal
 */
export function normalizePropsOrEmits(
    props: ComponentPropsOptions | EmitsOptions,
): ComponentObjectPropsOptions | ObjectEmitsOptions {
    return isArray(props)
        ? props.reduce(
            (normalized, p) => ((normalized[p] = null), normalized),
            {} as ComponentObjectPropsOptions | ObjectEmitsOptions,
        )
        : props
}

/**
 * Runtime helper for merging default declarations. Imported by compiled code
 * only.
 * @internal
 */
export function mergeDefaults(
    raw: ComponentPropsOptions,
    defaults: Record<string, any>,
): ComponentObjectPropsOptions {
    const props = normalizePropsOrEmits(raw)
    for (const key in defaults) {
        if (key.startsWith('__skip')) continue
        let opt = props[key]
        if (opt) {
            if (isArray(opt) || isFunction(opt)) {
                opt = props[key] = { type: opt, default: defaults[key] }
            } else {
                opt.default = defaults[key]
            }
        } else if (opt === null) {
            opt = props[key] = { default: defaults[key] }
        } else if (__DEV__) {
            warn(`props default key "${key}" has no corresponding declaration.`)
        }
        if (opt && defaults[`__skip_${key}`]) {
            opt.skipFactory = true
        }
    }
    return props
}

/**
 * Runtime helper for merging model declarations.
 * Imported by compiled code only.
 * @internal
 */
export function mergeModels(
    a: ComponentPropsOptions | EmitsOptions,
    b: ComponentPropsOptions | EmitsOptions,
): ComponentPropsOptions | EmitsOptions {
    if (!a || !b) return a || b
    if (isArray(a) && isArray(b)) return a.concat(b)
    return extend({}, normalizePropsOrEmits(a), normalizePropsOrEmits(b))
}

/**
 * Used to create a proxy for the rest element when destructuring props with
 * defineProps().
 * @internal
 */
export function createPropsRestProxy(
    props: any,
    excludedKeys: string[],
): Record<string, any> {
    const ret: Record<string, any> = {}
    for (const key in props) {
        if (!excludedKeys.includes(key)) {
            Object.defineProperty(ret, key, {
                enumerable: true,
                get: () => props[key],
            })
        }
    }
    return ret
}

/**
 * `<script setup>` helper for persisting the current instance context over
 * async/await flows.
 *
 * `@vue/compiler-sfc` converts the following:
 *
 * ```ts
 * const x = await foo()
 * ```
 *
 * into:
 *
 * ```ts
 * let __temp, __restore
 * const x = (([__temp, __restore] = withAsyncContext(() => foo())),__temp=await __temp,__restore(),__temp)
 * ```
 * @internal
 */
export function withAsyncContext(getAwaitable: () => any): [any, () => void] {
    const ctx = getCurrentInstance()!
    if (__DEV__ && !ctx) {
        warn(
            `withAsyncContext called without active current instance. ` +
            `This is likely a bug.`,
        )
    }
    let awaitable = getAwaitable()
    unsetCurrentInstance()

    const restore = () => {
        if (!ctx.scope.active) throw new Error('异步 setup 的组件作用域已经退休')
        setCurrentInstance(ctx)
    }

    // Never restore a captured "prev" instance here: in concurrent async setup
    // continuations it may belong to a sibling component and cause leaks.
    // We only need to balance ctx.scope.on() from setCurrentInstance(ctx),
    // then clear global currentInstance for user microtasks.
    const cleanup = () => {
        if (getCurrentInstance() !== ctx) ctx.scope.off()
        unsetCurrentInstance()
    }

    if (isPromise(awaitable)) {
        awaitable = awaitable.catch(e => {
            restore()
            // Defer cleanup so the async function's catch continuation
            // still runs with the restored instance.
            Promise.resolve().then(() => Promise.resolve().then(cleanup))
            throw e
        })
    }
    return [
        awaitable,
        () => {
            restore()
            // Keep instance for the current continuation, then cleanup.
            Promise.resolve().then(cleanup)
        },
    ]
}
