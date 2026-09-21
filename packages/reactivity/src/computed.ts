import { isFunction } from '@arrange/shared'
import { ReactiveFlags, TrackOpTypes } from './constants.ts'
import { Dep, type Link, globalVersion } from './dep.ts'
import { type DebuggerEvent, type DebuggerOptions, EffectFlags, type Subscriber, activeSub, batch, refreshComputed } from './effect.ts'
import type { Ref } from './ref.ts'
import { warn } from './warning.ts'

declare const ComputedRefSymbol: unique symbol
declare const WritableComputedRefSymbol: unique symbol

interface BaseComputedRef<T, S = T> extends Ref<T, S> {
    [ComputedRefSymbol]: true
    /**
     * @deprecated computed no longer uses effect
     */
    effect: ComputedRefImpl
}

export interface ComputedRef<T = any> extends BaseComputedRef<T> {
    readonly value: T
}

export interface WritableComputedRef<T, S = T> extends BaseComputedRef<T, S> {
    [WritableComputedRefSymbol]: true
}

export type ComputedGetter<T> = (oldValue?: T) => T
export type ComputedSetter<T> = (newValue: T) => void

export interface WritableComputedOptions<T, S = T> {
    get: ComputedGetter<T>
    set: ComputedSetter<S>
}

/**
 * @private 响应式核心实现，不从 Framework 用户入口导出
 */
export class ComputedRefImpl<T = any> implements Subscriber {
    /**
     * @internal
     */
    _value: any = undefined
    /**
     * @internal
     */
    readonly dep: Dep = new Dep(this)
    /**
     * @internal
     */
    readonly [ReactiveFlags.IS_REF] = true
    /**
     * @internal
     */
    readonly [ReactiveFlags.IS_READONLY]: boolean
    // A computed is also a subscriber that tracks other deps
    /**
     * @internal
     */
    deps?: Link = undefined
    /**
     * @internal
     */
    depsTail?: Link = undefined
    /**
     * @internal
     */
    flags: EffectFlags = EffectFlags.DIRTY
    /**
     * @internal
     */
    globalVersion: number = globalVersion - 1
    /**
     * @internal
     */

    /**
     * @internal
     */
    next?: Subscriber = undefined

    // for backwards compat
    effect: this = this
    // dev only
    onTrack?: (event: DebuggerEvent) => void
    // dev only
    onTrigger?: (event: DebuggerEvent) => void

    /**
     * Dev only
     * @internal
     */
    _warnRecursive?: boolean

    constructor(public fn: ComputedGetter<T>, private readonly setter: ComputedSetter<T> | undefined) {
        this[ReactiveFlags.IS_READONLY] = !setter

    }

    /**
     * @internal
     */
    notify(): true | void {
        this.flags |= EffectFlags.DIRTY
        if (
            !(this.flags & EffectFlags.NOTIFIED) &&
            // avoid infinite self recursion
            activeSub !== this
        ) {
            batch(this, true)
            return true
        }
    }

    get value(): T {
        const link = __DEV__
            ? this.dep.track({
                target: this,
                type: TrackOpTypes.GET,
                key: 'value',
            })
            : this.dep.track()
        refreshComputed(this)
        // sync version after evaluation
        if (link) {
            link.version = this.dep.version
        }
        return this._value
    }

    set value(newValue) {
        if (this.setter) {
            this.setter(newValue)
        } else if (__DEV__) {
            warn('Write operation failed: computed value is readonly')
        }
    }
}

export function computed<T>(getter: ComputedGetter<T>, debugOptions?: DebuggerOptions): ComputedRef<T>
export function computed<T, S = T>(options: WritableComputedOptions<T, S>, debugOptions?: DebuggerOptions): WritableComputedRef<T, S>
/*@__NO_SIDE_EFFECTS__*/
export function computed<T>(getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>, debugOptions?: DebuggerOptions) {
    let getter: ComputedGetter<T>
    let setter: ComputedSetter<T> | undefined

    if (isFunction(getterOrOptions)) {
        getter = getterOrOptions
    } else {
        getter = getterOrOptions.get
        setter = getterOrOptions.set
    }

    const cRef = new ComputedRefImpl(getter, setter)

    if (__DEV__ && debugOptions) {
        cRef.onTrack = debugOptions.onTrack
        cRef.onTrigger = debugOptions.onTrigger
    }

    return cRef as any
}