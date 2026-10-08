import { def, hasOwn, isObject, toRawType } from '@arrange/shared'
import { mutableHandlers, readonlyHandlers, shallowReactiveHandlers, shallowReadonlyHandlers } from './baseHandlers.ts'
import { mutableCollectionHandlers, readonlyCollectionHandlers, shallowCollectionHandlers, shallowReadonlyCollectionHandlers } from './collectionHandlers.ts'
import { ReactiveFlags } from './constants.ts'
import type { RawSymbol, Ref, UnwrapRefSimple } from './ref.ts'
import { warn } from './warning.ts'

export interface Target {
    [ReactiveFlags.SKIP]?: boolean
    [ReactiveFlags.IS_REACTIVE]?: boolean
    [ReactiveFlags.IS_READONLY]?: boolean
    [ReactiveFlags.IS_SHALLOW]?: boolean
    [ReactiveFlags.RAW]?: any
}

export const reactiveMap: WeakMap<Target, any> = new WeakMap<Target, any>()
export const shallowReactiveMap: WeakMap<Target, any> = new WeakMap<Target, any>()
export const readonlyMap: WeakMap<Target, any> = new WeakMap<Target, any>()
export const shallowReadonlyMap: WeakMap<Target, any> = new WeakMap<Target, any>()

enum TargetType {
    INVALID = 0,
    COMMON = 1,
    COLLECTION = 2,
}

function targetTypeMap(rawType: string) {
    switch (rawType) {
        case 'Object':
        case 'Array':
            return TargetType.COMMON
        case 'Map':
        case 'Set':
        case 'WeakMap':
        case 'WeakSet':
            return TargetType.COLLECTION
        default:
            return TargetType.INVALID
    }
}

function getTargetType(value: Target) {
    return value[ReactiveFlags.SKIP] || !Object.isExtensible(value) ? TargetType.INVALID : targetTypeMap(toRawType(value))
}

export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

declare const ReactiveMarkerSymbol: unique symbol

export interface ReactiveMarker {
    [ReactiveMarkerSymbol]?: void
}

export type Reactive<T> = UnwrapNestedRefs<T> &
    (T extends readonly any[] ? ReactiveMarker : {})

export function reactive<T extends object>(target: T): Reactive<T>
export function reactive(target: object) {
    if (isReadonly(target)) {
        return target
    }
    return createReactiveObject(target, false, mutableHandlers, mutableCollectionHandlers, reactiveMap)
}

declare class ShallowReactiveBrandClass {
    private __shallowReactiveBrand?: never
}

export type ShallowReactiveBrand = ShallowReactiveBrandClass

export type ShallowReactive<T> = T & ShallowReactiveBrand

export function shallowReactive<T extends object>(target: T): ShallowReactive<T> {
    return createReactiveObject(target, false, shallowReactiveHandlers, shallowCollectionHandlers, shallowReactiveMap)
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
export type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
    ? T
    : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends WeakMap<infer K, infer V>
    ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends Set<infer U>
    ? ReadonlySet<DeepReadonly<U>>
    : T extends ReadonlySet<infer U>
    ? ReadonlySet<DeepReadonly<U>>
    : T extends WeakSet<infer U>
    ? WeakSet<DeepReadonly<U>>
    : T extends Promise<infer U>
    ? Promise<DeepReadonly<U>>
    : T extends Ref<infer U, unknown>
    ? Readonly<Ref<DeepReadonly<U>>>
    : T extends {}
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : Readonly<T>

export function readonly<T extends object>(target: T): DeepReadonly<UnwrapNestedRefs<T>> {
    return createReactiveObject(target, true, readonlyHandlers, readonlyCollectionHandlers, readonlyMap)
}

export function shallowReadonly<T extends object>(target: T): Readonly<T> {
    return createReactiveObject(target, true, shallowReadonlyHandlers, shallowReadonlyCollectionHandlers, shallowReadonlyMap)
}

function createReactiveObject(target: Target, isReadonly: boolean, baseHandlers: ProxyHandler<any>, collectionHandlers: ProxyHandler<any>, proxyMap: WeakMap<Target, any>) {
    if (!isObject(target)) {
        if (__DEV__) {
            warn(`value cannot be made ${isReadonly ? 'readonly' : 'reactive'}: ${String(target)}`)
        }
        return target
    }
    if (
        target[ReactiveFlags.RAW] && !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
    ) {
        return target
    }
    const targetType = getTargetType(target)
    if (targetType === TargetType.INVALID) {
        return target
    }
    const existingProxy = proxyMap.get(target)
    if (existingProxy) {
        return existingProxy
    }
    const proxy = new Proxy(target, targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers)
    proxyMap.set(target, proxy)
    return proxy
}

export function isReactive(value: unknown): boolean {
    if (isReadonly(value)) {
        return isReactive((value as Target)[ReactiveFlags.RAW])
    }
    return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
    return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isShallow(value: unknown): boolean {
    return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export function isProxy(value: any): boolean {
    return value ? !!value[ReactiveFlags.RAW] : false
}

export function toRaw<T>(observed: T): T {
    const raw = observed && (observed as Target)[ReactiveFlags.RAW]
    return raw ? toRaw(raw) : observed
}

export type Raw<T> = T & { [RawSymbol]?: true }

export function markRaw<T extends object>(value: T): Raw<T> {
    if (!hasOwn(value, ReactiveFlags.SKIP) && Object.isExtensible(value)) {
        def(value, ReactiveFlags.SKIP, true)
    }
    return value
}

export const toReactive = <T extends unknown>(value: T): T => isObject(value) ? reactive(value) : value

export const toReadonly = <T extends unknown>(value: T): DeepReadonly<T> => isObject(value) ? readonly(value) : (value as DeepReadonly<T>)