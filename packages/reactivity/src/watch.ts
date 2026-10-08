import { EMPTY_OBJ, NOOP, hasChanged, isArray, isFunction, isMap, isObject, isPlainObject, isSet, remove } from '@arrange/shared'
import type { ComputedRef } from './computed.ts'
import { ReactiveFlags } from './constants.ts'
import { type DebuggerOptions, EffectFlags, type EffectScheduler, ReactiveEffect, pauseTracking, resetTracking } from './effect.ts'
import { getCurrentScope } from './effectScope.ts'
import { isReactive, isShallow } from './reactive.ts'
import { type Ref, isRef } from './ref.ts'
import { warn } from './warning.ts'

export enum WatchErrorCodes {
    WATCH_GETTER = 2,
    WATCH_CALLBACK,
    WATCH_CLEANUP,
}

export type WatchEffect = (onCleanup: OnCleanup) => void

export type WatchSource<T = any> = Ref<T, any> | ComputedRef<T> | (() => T)

export type WatchCallback<V = any, OV = any> = (value: V, oldValue: OV, onCleanup: OnCleanup) => any

export type OnCleanup = (cleanupFn: () => void) => void

export interface WatchOptions<Immediate = boolean> extends DebuggerOptions {
    immediate?: Immediate
    deep?: boolean | number
    once?: boolean
    scheduler?: WatchScheduler
    onWarn?: (msg: string, ...args: any[]) => void
    augmentJob?: (job: (...args: any[]) => void) => void
    call?: (fn: Function | Function[], type: WatchErrorCodes, args?: unknown[]) => void
}

export type WatchStopHandle = () => void

export interface WatchHandle extends WatchStopHandle {
    pause: () => void
    resume: () => void
    stop: () => void
}

const INITIAL_WATCHER_VALUE = {}

export type WatchScheduler = (job: () => void, isFirstRun: boolean) => void

const cleanupMap: WeakMap<ReactiveEffect, (() => void)[]> = new WeakMap()
let activeWatcher: ReactiveEffect | undefined = undefined

export function getCurrentWatcher(): ReactiveEffect<any> | undefined {
    return activeWatcher
}

export function onWatcherCleanup(cleanupFn: () => void, failSilently = false, owner: ReactiveEffect | undefined = activeWatcher): void {
    if (owner) {
        let cleanups = cleanupMap.get(owner)
        if (!cleanups) cleanupMap.set(owner, (cleanups = []))
        cleanups.push(cleanupFn)
    } else if (__DEV__ && !failSilently) {
        warn(`onWatcherCleanup() was called when there was no active watcher` + ` to associate with.`)
    }
}

export function watch(source: WatchSource | WatchSource[] | WatchEffect | object, cb?: WatchCallback | null, options: WatchOptions = EMPTY_OBJ): WatchHandle {
    const { immediate, deep, once, scheduler, augmentJob, call } = options

    const warnInvalidSource = (s: unknown) => {

        (options.onWarn || warn)(`Invalid watch source: `, s, `A watch source can only be a getter/effect function, a ref, ` + `a reactive object, or an array of these types.`)
    }

    const reactiveGetter = (source: object) => {
        if (deep) return source
        if (isShallow(source) || deep === false || deep === 0)
            return traverse(source, 1)
        return traverse(source)
    }

    let effect: ReactiveEffect
    let getter: () => any
    let cleanup: (() => void) | undefined
    let boundCleanup: typeof onWatcherCleanup
    let forceTrigger = false
    let isMultiSource = false

    if (isRef(source)) {
        getter = () => source.value
        forceTrigger = isShallow(source)
    } else if (isReactive(source)) {
        getter = () => reactiveGetter(source)
        forceTrigger = true
    } else if (isArray(source)) {
        isMultiSource = true
        forceTrigger = source.some(s => isReactive(s) || isShallow(s))
        getter = () =>
            source.map(s => {
                if (isRef(s)) {
                    return s.value
                } else if (isReactive(s)) {
                    return reactiveGetter(s)
                } else if (isFunction(s)) {
                    return call ? call(s, WatchErrorCodes.WATCH_GETTER) : s()
                } else {
                    __DEV__ && warnInvalidSource(s)
                }
            })
    } else if (isFunction(source)) {
        if (cb) {
            getter = call ? () => call(source, WatchErrorCodes.WATCH_GETTER) : (source as () => any)
        } else {
            getter = () => {
                if (cleanup) {
                    pauseTracking()
                    try {
                        cleanup()
                    } finally {
                        resetTracking()
                    }
                }
                const currentEffect = activeWatcher
                activeWatcher = effect
                try {
                    return call
                        ? call(source, WatchErrorCodes.WATCH_CALLBACK, [boundCleanup])
                        : source(boundCleanup)
                } finally {
                    activeWatcher = currentEffect
                }
            }
        }
    } else {
        getter = NOOP
        __DEV__ && warnInvalidSource(source)
    }

    if (cb && deep) {
        const baseGetter = getter
        const depth = deep === true ? Infinity : deep
        getter = () => traverse(baseGetter(), depth)
    }

    const scope = getCurrentScope()
    const watchHandle: WatchHandle = () => {
        effect.stop()
        if (scope && scope.active) {
            remove(scope.effects, effect)
        }
    }

    if (once && cb) {
        const _cb = cb
        cb = (...args) => {
            _cb(...args)
            watchHandle()
        }
    }

    let oldValue: any = isMultiSource ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE

    const job = (immediateFirstRun?: boolean) => {
        if (
            !(effect.flags & EffectFlags.ACTIVE) || (effect.flags & EffectFlags.PAUSED) || (!effect.dirty && !immediateFirstRun)
        ) {
            return
        }
        if (cb) {
            const newValue = effect.run()
            if (
                deep || forceTrigger || (isMultiSource ? (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i])) : hasChanged(newValue, oldValue))
            ) {
                if (cleanup) {
                    cleanup()
                }
                const currentWatcher = activeWatcher
                activeWatcher = effect
                try {
                    const args: Parameters<WatchCallback> = [
                        newValue,
                        oldValue === INITIAL_WATCHER_VALUE
                            ? undefined
                            : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE
                                ? []
                                : oldValue,
                        boundCleanup,
                    ]
                    oldValue = newValue
                    call ? call(cb!, WatchErrorCodes.WATCH_CALLBACK, args) : cb!(...args)
                } finally {
                    activeWatcher = currentWatcher
                }
            }
        } else {
            effect.run()
        }
    }

    if (augmentJob) {
        augmentJob(job)
    }

    effect = new ReactiveEffect(getter)

    effect.scheduler = scheduler ? () => scheduler(job, false) : (job as EffectScheduler)

    boundCleanup = fn => onWatcherCleanup(fn, false, effect)

    cleanup = effect.onStop = () => {
        const cleanups = cleanupMap.get(effect)
        if (cleanups) {
            if (call) {
                call(cleanups, WatchErrorCodes.WATCH_CLEANUP)
            } else {
                for (const cleanup of cleanups) cleanup()
            }
            cleanupMap.delete(effect)
        }
    }

    if (__DEV__) {
        effect.onTrack = options.onTrack
        effect.onTrigger = options.onTrigger
    }

    if (cb) {
        if (immediate) {
            job(true)
        } else {
            oldValue = effect.run()
        }
    } else if (scheduler) {
        const initialJob = job.bind(null, true)
        augmentJob?.(initialJob)
        scheduler(initialJob, true)
    } else {
        effect.run()
    }

    watchHandle.pause = effect.pause.bind(effect)
    watchHandle.resume = effect.resume.bind(effect)
    watchHandle.stop = watchHandle

    return watchHandle
}

export function traverse(value: unknown, depth: number = Infinity, seen?: Map<unknown, number>): unknown {
    if (depth <= 0 || !isObject(value) || (value as any)[ReactiveFlags.SKIP]) {
        return value
    }

    seen = seen || new Map()
    if ((seen.get(value) || 0) >= depth) {
        return value
    }
    seen.set(value, depth)
    depth--
    if (isRef(value)) {
        traverse(value.value, depth, seen)
    } else if (isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            traverse(value[i], depth, seen)
        }
    } else if (isSet(value) || isMap(value)) {
        value.forEach((v: any) => {
            traverse(v, depth, seen)
        })
    } else if (isPlainObject(value)) {
        for (const key in value) {
            traverse(value[key], depth, seen)
        }
        for (const key of Object.getOwnPropertySymbols(value)) {
            if (Object.prototype.propertyIsEnumerable.call(value, key)) {
                traverse(value[key as any], depth, seen)
            }
        }
    }
    return value
}
