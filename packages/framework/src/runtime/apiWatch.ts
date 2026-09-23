import {type DebuggerOptions, type ReactiveMarker, watch as baseWatch, type WatchCallback, type WatchEffect, type WatchHandle, type WatchOptions as BaseWatchOptions, type WatchSource} from '@arrange/reactivity'
import {EMPTY_OBJ, extend, isFunction} from '@arrange/shared'
import {currentInstance} from './arrangable.ts'
import {callWithAsyncErrorHandling} from './errorHandling.ts'
import {queueJob, queuePostFlushCb, type SchedulerJob} from './scheduler.ts'
import {findFrameScheduler} from './animationOwner.ts'
import {warn} from './warning.ts'

export type {OnCleanup, WatchCallback, WatchEffect, WatchHandle, WatchSource, WatchStopHandle} from '@arrange/reactivity'

type MaybeUndefined<T, I> = I extends true ? T | undefined : T

type MapSources<T, Immediate> = { [K in keyof T]: T[K] extends WatchSource<infer V> ? MaybeUndefined<V, Immediate> : T[K] extends object ? MaybeUndefined<T[K], Immediate> : never }

export interface WatchEffectOptions extends DebuggerOptions {
    flush?: 'pre' | 'post' | 'sync'
}

export interface WatchOptions<Immediate = boolean> extends WatchEffectOptions {
    immediate?: Immediate
    deep?: boolean | number
    once?: boolean
}

// 观察函数及其所属作用域共用调度入口
export function watchEffect(effect: WatchEffect, options?: WatchEffectOptions): WatchHandle {
    return doWatch(effect, null, options)
}

export function watchPostEffect(effect: WatchEffect, options?: DebuggerOptions): WatchHandle {
    return doWatch(effect, null, __DEV__ ? extend({}, options as WatchEffectOptions, {flush: 'post'}) : {flush: 'post'})
}

export function watchSyncEffect(effect: WatchEffect, options?: DebuggerOptions): WatchHandle {
    return doWatch(effect, null, __DEV__ ? extend({}, options as WatchEffectOptions, {flush: 'sync'}) : {flush: 'sync'})
}

export type MultiWatchSources = (WatchSource<unknown> | object)[]

// 单源观察
export function watch<T, Immediate extends Readonly<boolean> = false>(source: WatchSource<T>, cb: WatchCallback<T, MaybeUndefined<T, Immediate>>, options?: WatchOptions<Immediate>): WatchHandle

// 反应式数组或元组观察
export function watch<T extends Readonly<MultiWatchSources>, Immediate extends Readonly<boolean> = false>(sources: readonly [...T] | T, cb: [T] extends [ReactiveMarker] ? WatchCallback<T, MaybeUndefined<T, Immediate>> : WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>, options?: WatchOptions<Immediate>): WatchHandle

// 多源数组观察
export function watch<T extends MultiWatchSources, Immediate extends Readonly<boolean> = false>(sources: [...T], cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>, options?: WatchOptions<Immediate>): WatchHandle

// 对象观察
export function watch<T extends object, Immediate extends Readonly<boolean> = false>(source: T, cb: WatchCallback<T, MaybeUndefined<T, Immediate>>, options?: WatchOptions<Immediate>): WatchHandle

// 统一实现
export function watch<T = any, Immediate extends Readonly<boolean> = false>(source: T | WatchSource<T>, cb: any, options?: WatchOptions<Immediate>): WatchHandle {
    if (__DEV__ && !isFunction(cb)) warn('watch 需要 source 和 callback，直接观察函数请使用 watchEffect')

    return doWatch(source as any, cb, options)
}

function doWatch(source: WatchSource | WatchSource[] | WatchEffect | object, cb: WatchCallback | null, options: WatchOptions = EMPTY_OBJ): WatchHandle {
    const {immediate, deep, flush, once} = options

    if (__DEV__ && !cb) {
        if (immediate !== undefined) warn('immediate 选项仅用于 watch(source, callback, options)')

        if (deep !== undefined) warn('deep 选项仅用于 watch(source, callback, options)')

        if (once !== undefined) warn('once 选项仅用于 watch(source, callback, options)')
    }

    const baseWatchOptions: BaseWatchOptions = extend({}, options)

    if (__DEV__) baseWatchOptions.onWarn = warn

    const instance = currentInstance
    const scheduler = findFrameScheduler()
    baseWatchOptions.call = (fn, type, args) => callWithAsyncErrorHandling(fn, instance, type, args)

    // UI 观察按正式帧阶段排队
    let isPre = false
    if (flush === 'post') baseWatchOptions.scheduler = job => queuePostFlushCb(job)
    else if (flush !== 'sync') {
        // 默认在本帧结构和值收集前执行
        isPre = true
        baseWatchOptions.scheduler = (job, isFirstRun) => {
            if (isFirstRun) job()
            else queueJob(job)
        }
    }

    baseWatchOptions.augmentJob = (job: SchedulerJob) => {
        job.i = instance ?? undefined
        job.scheduler = scheduler
        if (isPre) job.phase = 'pre'
    }

    return baseWatch(source, cb, baseWatchOptions)
}
