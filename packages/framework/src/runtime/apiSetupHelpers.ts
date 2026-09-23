import {type Prettify, isArray, isFunction} from '@arrange/shared'
import {type SetupContext, getCurrentInstance} from './arrangable.ts'
import type {ArrangableObjectPropsOptions, ArrangablePropsOptions, ExtractPropTypes} from './arrangableProps.ts'
import {warn} from './warning.ts'

// overload 1: runtime props w/ array
export function defineProps<PropNames extends string = string>(props: PropNames[]): Prettify<Readonly<{ [key in PropNames]?: any }>>
// overload 2: runtime props w/ object
export function defineProps<PP extends ArrangableObjectPropsOptions = ArrangableObjectPropsOptions>(props: PP): Prettify<Readonly<ExtractPropTypes<PP>>>
export function defineProps<TypeProps>(): Readonly<TypeProps>
export function defineProps(): never {
    throw new Error('defineProps 只能在 SFA script 中由编译器处理')
}

export type DefineProps<T> = Readonly<T>

type NotUndefined<T> = T extends undefined ? never : T
type MappedOmit<T, K extends keyof any> = { [P in keyof T as P extends K ? never : P]: T[P] }

type InferDefaults<T> = { [K in keyof T]?: InferDefault<T, T[K]> }

type NativeType = | null | undefined | number | string | boolean | symbol | Function

type InferDefault<P, T> = ((props: P) => T & {}) | (T extends NativeType ? T : never)

type PropsWithDefaults<T, Defaults extends InferDefaults<T>> = Readonly<Omit<T, keyof Defaults>> & { readonly [K in keyof Defaults as K extends keyof T ? K : never]-?: K extends keyof T ? Defaults[K] extends undefined ? T[K] : NotUndefined<T[K]> : never }

export function withDefaults<T, Defaults extends InferDefaults<T>>(props: Readonly<T>, defaults: Defaults): PropsWithDefaults<T, Defaults> {
    throw new Error('withDefaults 只能在 SFA script 中由编译器处理')
}

export function useSlots(): SetupContext['slots'] {
    return getContext('useSlots').slots
}

function getContext(calledFunctionName: string): SetupContext {
    const i = getCurrentInstance()!

    if (__DEV__ && !i) warn(`在没有活跃实例的情况下调用了 ${calledFunctionName}()`)

    return i.setupContext
}

export function normalizePropDeclarations(props: ArrangablePropsOptions): ArrangableObjectPropsOptions {
    return isArray(props) ? props.reduce((normalized, p) => ((normalized[p] = null), normalized), {} as ArrangableObjectPropsOptions,) : props
}

// 用于合并默认声明的运行时辅助程序。仅供编译后的代码导入
export function mergeDefaults(raw: ArrangablePropsOptions, defaults: Record<string, any>): ArrangableObjectPropsOptions {
    const props = normalizePropDeclarations(raw)

    for (const key in defaults) {
        if (key.startsWith('__skip')) continue

        let opt = props[key]
        if (opt) {
            if (isArray(opt) || isFunction(opt)) opt = props[key] = {type: opt, default: defaults[key]}
            else opt.default = defaults[key]
        } else if (opt === null) opt = props[key] = {default: defaults[key]}
        else if (__DEV__) warn(`props default key "${key}" has no corresponding declaration.`)

        if (opt && defaults[`__skip_${key}`]) opt.skipFactory = true
    }

    return props
}

// 用于在使用 `defineProps()` 对 props 进行解构时，为剩余元素创建代理
export function createPropsRestProxy(props: any, excludedKeys: string[]): Record<string, any> {
    const ret: Record<string, any> = {}

    for (const key in props) if (!excludedKeys.includes(key)) Object.defineProperty(ret, key, {enumerable: true, get: () => props[key]})

    return ret
}