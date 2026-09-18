import {
    type IfAny,
    hasChanged,
    isArray,
    isFunction,
    isIntegerKey,
    isObject,
    isSymbol,
} from '@arrange/vue-shared'
import type { ComputedRef, WritableComputedRef } from './computed.ts'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants.ts'
import { Dep, getDepFromReactive } from './dep.ts'
import {
    type Builtin,
    type ShallowReactiveBrand,
    type Target,
    isProxy,
    isReactive,
    isReadonly,
    isShallow,
    toRaw,
    toReactive,
} from './reactive.ts'
import { warn } from './warning.ts'

declare const RefSymbol: unique symbol
export declare const RawSymbol: unique symbol

export interface Ref<T = any, S = T> {
    get value(): T
    set value(_: S)
    /**
     * Type differentiator only.
     * We need this to be in public d.ts but don't want it to show up in IDE
     * autocomplete, so we use a private Symbol instead.
     */
    [RefSymbol]: true
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
/*@__NO_SIDE_EFFECTS__*/
export function isRef(r: any): r is Ref {
    return r ? r[ReactiveFlags.IS_REF] === true : false
}

export function ref<T>(
    value: T,
): [T] extends [Ref] ? IfAny<T, Ref<T>, T> : Ref<UnwrapRef<T>, UnwrapRef<T> | T>
export function ref<T = any>(): Ref<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function ref(value?: unknown) {
    return createRef(value, false)
}

declare const ShallowRefMarker: unique symbol

export type ShallowRef<T = any, S = T> = Ref<T, S> & {
    [ShallowRefMarker]?: true
}

export function shallowRef<T>(
    value: T,
): Ref extends T
    ? T extends Ref
    ? IfAny<T, ShallowRef<T>, T>
    : ShallowRef<T>
    : ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function shallowRef(value?: unknown) {
    return createRef(value, true)
}

function createRef(rawValue: unknown, shallow: boolean) {
    if (isRef(rawValue)) {
        return rawValue
    }
    return new RefImpl(rawValue, shallow)
}

/**
 * @internal
 */
class RefImpl<T = any> {
    _value: T
    private _rawValue: T

    dep: Dep = new Dep()

    public readonly [ReactiveFlags.IS_REF] = true
    public readonly [ReactiveFlags.IS_SHALLOW]: boolean = false

    constructor(value: T, isShallow: boolean) {
        this._rawValue = isShallow ? value : toRaw(value)
        this._value = isShallow ? value : toReactive(value)
        this[ReactiveFlags.IS_SHALLOW] = isShallow
    }

    get value() {
        if (__DEV__) {
            this.dep.track({
                target: this,
                type: TrackOpTypes.GET,
                key: 'value',
            })
        } else {
            this.dep.track()
        }
        return this._value
    }

    set value(newValue) {
        const oldValue = this._rawValue
        const useDirectValue =
            this[ReactiveFlags.IS_SHALLOW] ||
            isShallow(newValue) ||
            isReadonly(newValue)
        newValue = useDirectValue ? newValue : toRaw(newValue)
        if (hasChanged(newValue, oldValue)) {
            this._rawValue = newValue
            this._value = useDirectValue ? newValue : toReactive(newValue)
            if (__DEV__) {
                this.dep.trigger({
                    target: this,
                    type: TriggerOpTypes.SET,
                    key: 'value',
                    newValue,
                    oldValue,
                })
            } else {
                this.dep.trigger()
            }
        }
    }
}

export function triggerRef(ref: Ref): void {
    // ref may be an instance of ObjectRefImpl
    if ((ref as unknown as RefImpl).dep) {
        if (__DEV__) {
            ; (ref as unknown as RefImpl).dep.trigger({
                target: ref,
                type: TriggerOpTypes.SET,
                key: 'value',
                newValue: (ref as unknown as RefImpl)._value,
            })
        } else {
            ; (ref as unknown as RefImpl).dep.trigger()
        }
    }
}

export type MaybeRef<T = any> =
    | T
    | Ref<T>
    | ShallowRef<T>
    | WritableComputedRef<T>

export type MaybeRefOrGetter<T = any> = MaybeRef<T> | ComputedRef<T> | (() => T)

export function unref<T>(ref: MaybeRef<T> | ComputedRef<T>): T {
    return isRef(ref) ? ref.value : ref
}

export function toValue<T>(source: MaybeRefOrGetter<T>): T {
    return isFunction(source) ? source() : unref(source)
}

const shallowUnwrapHandlers: ProxyHandler<any> = {
    get: (target, key, receiver) =>
        key === ReactiveFlags.RAW
            ? target
            : unref(Reflect.get(target, key, receiver)),
    set: (target, key, value, receiver) => {
        const oldValue = target[key]
        if (isRef(oldValue) && !isRef(value)) {
            oldValue.value = value
            return true
        } else {
            return Reflect.set(target, key, value, receiver)
        }
    },
}

/**
 * Returns a proxy for the given object that shallowly unwraps properties that
 * are refs. If the object already is reactive, it's returned as-is. If not, a
 * new reactive proxy is created.
 *
 * @param objectWithRefs - Either an already-reactive object or a simple object
 * that contains refs.
 */
export function proxyRefs<T extends object>(
    objectWithRefs: T,
): ShallowUnwrapRef<T> {
    return isReactive(objectWithRefs)
        ? (objectWithRefs as ShallowUnwrapRef<T>)
        : new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

export type CustomRefFactory<T, S = T> = (
    track: () => void,
    trigger: () => void,
) => {
    get: () => T
    set: (value: S) => void
}

class CustomRefImpl<T, S = T> {
    public dep: Dep

    private readonly _get: ReturnType<CustomRefFactory<T, S>>['get']
    private readonly _set: ReturnType<CustomRefFactory<T, S>>['set']

    public readonly [ReactiveFlags.IS_REF] = true

    public _value: T = undefined!

    constructor(factory: CustomRefFactory<T, S>) {
        const dep = (this.dep = new Dep())
        const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep))
        this._get = get
        this._set = set
    }

    get value(): T {
        return (this._value = this._get())
    }

    set value(newVal: S) {
        this._set(newVal)
    }
}

export function customRef<T, S = T>(
    factory: CustomRefFactory<T, S>,
): Ref<T, S> {
    return new CustomRefImpl(factory) as any
}

export type ToRefs<T = any> = {
    [K in keyof T]: ToRef<T[K]>
}

type ArrayStringKey<T> = T extends readonly any[]
    ? number extends T['length']
    ? `${number}`
    : never
    : never

type ToRefKey<T> = keyof T | ArrayStringKey<T>

type ToRefValue<T extends object, K extends ToRefKey<T>> = K extends keyof T
    ? T[K]
    : T extends readonly (infer V)[]
    ? K extends ArrayStringKey<T>
    ? V
    : never
    : never

/*@__NO_SIDE_EFFECTS__*/
export function toRefs<T extends object>(object: T): ToRefs<T> {
    if (__DEV__ && !isProxy(object)) {
        warn(`toRefs() expects a reactive object but received a plain one.`)
    }
    const ret: any = isArray(object) ? new Array(object.length) : {}
    for (const key in object) {
        ret[key] = propertyToRef(object, key)
    }
    return ret
}

class ObjectRefImpl<T extends object, K extends keyof T> {
    public readonly [ReactiveFlags.IS_REF] = true
    public _value: T[K] = undefined!

    private readonly _raw: T
    private readonly _key: K
    private readonly _shallow: boolean

    constructor(
        private readonly _object: T,
        key: K,
        private readonly _defaultValue?: T[K],
    ) {
        this._key = (isSymbol(key) ? key : String(key)) as K
        this._raw = toRaw(_object)

        let shallow = true
        let obj = _object

        // For an array with integer key, refs are not unwrapped
        if (!isArray(_object) || isSymbol(this._key) || !isIntegerKey(this._key)) {
            // Otherwise, check each proxy layer for unwrapping
            do {
                shallow = !isProxy(obj) || isShallow(obj)
            } while (shallow && (obj = (obj as Target)[ReactiveFlags.RAW]))
        }

        this._shallow = shallow
    }

    get value() {
        let val = this._object[this._key]
        if (this._shallow) {
            val = unref(val)
        }
        return (this._value = val === undefined ? this._defaultValue! : val)
    }

    set value(newVal) {
        if (this._shallow && isRef(this._raw[this._key])) {
            const nestedRef = this._object[this._key]
            if (isRef(nestedRef)) {
                nestedRef.value = newVal
                return
            }
        }

        this._object[this._key] = newVal
    }

    get dep(): Dep | undefined {
        return getDepFromReactive(this._raw, this._key)
    }
}

class GetterRefImpl<T> {
    public readonly [ReactiveFlags.IS_REF] = true
    public readonly [ReactiveFlags.IS_READONLY] = true
    public _value: T = undefined!

    constructor(private readonly _getter: () => T) { }
    get value() {
        return (this._value = this._getter())
    }
}

export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>

export function toRef<T>(
    value: T,
): T extends () => infer R
    ? Readonly<Ref<R>>
    : T extends Ref
    ? T
    : Ref<UnwrapRef<T>>
export function toRef<T extends object, K extends ToRefKey<T>>(
    object: T,
    key: K,
): ToRef<ToRefValue<T, K>>
export function toRef<T extends object, K extends ToRefKey<T>>(
    object: T,
    key: K,
    defaultValue: ToRefValue<T, K>,
): ToRef<Exclude<ToRefValue<T, K>, undefined>>
/*@__NO_SIDE_EFFECTS__*/
export function toRef(
    source: Record<PropertyKey, any> | MaybeRef,
    key?: string | number | symbol,
    defaultValue?: unknown,
): Ref {
    if (isRef(source)) {
        return source
    } else if (isFunction(source)) {
        return new GetterRefImpl(source) as any
    } else if (isObject(source) && arguments.length > 1) {
        return propertyToRef(source, key!, defaultValue)
    } else {
        return ref(source)
    }
}

function propertyToRef(
    source: Record<PropertyKey, any>,
    key: string | number | symbol,
    defaultValue?: unknown,
) {
    return new ObjectRefImpl(source, key, defaultValue) as any
}

export interface RefUnwrapBailTypes { }

export type ShallowUnwrapRef<T> = T extends ShallowReactiveBrand
    ? T
    : {
        [K in keyof T]: DistributeRef<T[K]>
    }

type DistributeRef<T> = T extends Ref<infer V, unknown> ? V : T

export type UnwrapRef<T> =
    T extends ShallowRef<infer V, unknown>
    ? V
    : T extends Ref<infer V, unknown>
    ? UnwrapRefSimple<V>
    : UnwrapRefSimple<T>

export type UnwrapRefSimple<T> = T extends
    | Builtin
    | Ref
    | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
    | { [RawSymbol]?: true }
    ? T
    : T extends ShallowReactiveBrand
    ? T
    : T extends Map<infer K, infer V>
    ? Map<K, UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Map<any, any>>>
    : T extends WeakMap<infer K, infer V>
    ? WeakMap<K, UnwrapRefSimple<V>> &
    UnwrapRef<Omit<T, keyof WeakMap<any, any>>>
    : T extends Set<infer V>
    ? Set<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Set<any>>>
    : T extends WeakSet<infer V>
    ? WeakSet<UnwrapRefSimple<V>> &
    UnwrapRef<Omit<T, keyof WeakSet<any>>>
    : T extends ReadonlyArray<any>
    ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
    : T extends object
    ? {
        [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
    }
    : T
