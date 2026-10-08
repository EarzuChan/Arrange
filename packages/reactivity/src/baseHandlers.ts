import { hasChanged, hasOwn, isArray, isIntegerKey, isObject, isSymbol, makeMap } from '@arrange/shared'
import { arrayInstrumentations } from './arrayInstrumentations.ts'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants.ts'
import { ITERATE_KEY, track, trigger } from './dep.ts'
import { type Target, isReadonly, isShallow, reactive, reactiveMap, readonly, readonlyMap, shallowReactiveMap, shallowReadonlyMap, toRaw } from './reactive.ts'
import { isRef } from './ref.ts'
import { warn } from './warning.ts'

const isNonTrackableKeys = makeMap(`__proto__,${ReactiveFlags.IS_REF}`)

const builtInSymbols = new Set(Object.getOwnPropertyNames(Symbol).filter(key => key !== 'arguments' && key !== 'caller').map(key => Symbol[key as keyof SymbolConstructor]).filter(isSymbol))

function hasOwnProperty(this: object, key: unknown) {
    if (!isSymbol(key)) key = String(key)
    const obj = toRaw(this)
    track(obj, TrackOpTypes.HAS, key)
    return obj.hasOwnProperty(key as string)
}

class BaseReactiveHandler implements ProxyHandler<Target> {
    constructor(protected readonly _isReadonly = false, protected readonly _isShallow = false) { }

    get(target: Target, key: string | symbol, receiver: object): any {
        if (key === ReactiveFlags.SKIP) return target[ReactiveFlags.SKIP]

        const isReadonly = this._isReadonly, isShallow = this._isShallow
        if (key === ReactiveFlags.IS_REACTIVE) {
            return !isReadonly
        } else if (key === ReactiveFlags.IS_READONLY) {
            return isReadonly
        } else if (key === ReactiveFlags.IS_SHALLOW) {
            return isShallow
        } else if (key === ReactiveFlags.RAW) {
            if (
                receiver === (isReadonly ? isShallow ? shallowReadonlyMap : readonlyMap : isShallow ? shallowReactiveMap : reactiveMap).get(target) || Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
            ) {
                return target
            }
            return
        }

        const targetIsArray = isArray(target)

        if (!isReadonly) {
            let fn: Function | undefined
            if (targetIsArray && (fn = arrayInstrumentations[key])) {
                return fn
            }
            if (key === 'hasOwnProperty') {
                return hasOwnProperty
            }
        }

        const res = Reflect.get(target, key, isRef(target) ? target : receiver)

        if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
            return res
        }

        if (!isReadonly) {
            track(target, TrackOpTypes.GET, key)
        }

        if (isShallow) {
            return res
        }

        if (isRef(res)) {
            const value = targetIsArray && isIntegerKey(key) ? res : res.value
            return isReadonly && isObject(value) ? readonly(value) : value
        }

        if (isObject(res)) {
            return isReadonly ? readonly(res) : reactive(res)
        }

        return res
    }
}

class MutableReactiveHandler extends BaseReactiveHandler {
    constructor(isShallow = false) {
        super(false, isShallow)
    }

    set(target: Record<string | symbol, unknown>, key: string | symbol, value: unknown, receiver: object): boolean {
        let oldValue = target[key]
        const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key)
        if (!this._isShallow) {
            const isOldValueReadonly = isReadonly(oldValue)
            if (!isShallow(value) && !isReadonly(value)) {
                oldValue = toRaw(oldValue)
                value = toRaw(value)
            }
            if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
                if (isOldValueReadonly) {
                    if (__DEV__) {
                        warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target[key])
                    }
                    return true
                } else {
                    oldValue.value = value
                    return true
                }
            }
        } else {
        }

        const hadKey = isArrayWithIntegerKey ? Number(key) < target.length : hasOwn(target, key)
        const result = Reflect.set(target, key, value, isRef(target) ? target : receiver)
        if (target === toRaw(receiver)) {
            if (!hadKey) {
                trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
                trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
        }
        return result
    }

    deleteProperty(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
        const hadKey = hasOwn(target, key)
        const oldValue = target[key]
        const result = Reflect.deleteProperty(target, key)
        if (result && hadKey) {
            trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
        }
        return result
    }

    has(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
        const result = Reflect.has(target, key)
        if (!isSymbol(key) || !builtInSymbols.has(key)) {
            track(target, TrackOpTypes.HAS, key)
        }
        return result
    }

    ownKeys(target: Record<string | symbol, unknown>): (string | symbol)[] {
        track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
        return Reflect.ownKeys(target)
    }
}

class ReadonlyReactiveHandler extends BaseReactiveHandler {
    constructor(isShallow = false) {
        super(true, isShallow)
    }

    set(target: object, key: string | symbol) {
        if (__DEV__) {
            warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target)
        }
        return true
    }

    deleteProperty(target: object, key: string | symbol) {
        if (__DEV__) {
            warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target)
        }
        return true
    }
}

export const mutableHandlers: ProxyHandler<object> = new MutableReactiveHandler()

export const readonlyHandlers: ProxyHandler<object> = new ReadonlyReactiveHandler()

export const shallowReactiveHandlers: MutableReactiveHandler = new MutableReactiveHandler(true)

export const shallowReadonlyHandlers: ReadonlyReactiveHandler = new ReadonlyReactiveHandler(true)