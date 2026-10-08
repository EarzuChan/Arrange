import { extend, hasChanged } from '@arrange/shared'
import type { ComputedRefImpl } from './computed.ts'
import type { TrackOpTypes, TriggerOpTypes } from './constants.ts'
import { type Link, globalVersion } from './dep.ts'
import { activeEffectScope } from './effectScope.ts'
import { warn } from './warning.ts'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
    effect: Subscriber
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
    target: object
    type: TrackOpTypes | TriggerOpTypes
    key: any
    newValue?: any
    oldValue?: any
    oldTarget?: Map<any, any> | Set<any>
}

export interface DebuggerOptions {
    onTrack?: (event: DebuggerEvent) => void
    onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
    scheduler?: EffectScheduler
    allowRecurse?: boolean
    onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
    (): T
    effect: ReactiveEffect
}

export let activeSub: Subscriber | undefined

export enum EffectFlags {
    ACTIVE = 1 << 0,
    RUNNING = 1 << 1,
    TRACKING = 1 << 2,
    NOTIFIED = 1 << 3,
    DIRTY = 1 << 4,
    ALLOW_RECURSE = 1 << 5,
    PAUSED = 1 << 6,
    EVALUATED = 1 << 7,
}

export interface Subscriber extends DebuggerOptions {
    deps?: Link
    depsTail?: Link
    flags: EffectFlags
    next?: Subscriber
    notify(): true | void
}

const pausedQueueEffects = new WeakSet<ReactiveEffect>()

export class ReactiveEffect<T = any>
    implements Subscriber, ReactiveEffectOptions {
    deps?: Link = undefined
    depsTail?: Link = undefined
    flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
    next?: Subscriber = undefined
    cleanup?: () => void = undefined

    scheduler?: EffectScheduler = undefined
    onStop?: () => void
    onTrack?: (event: DebuggerEvent) => void
    onTrigger?: (event: DebuggerEvent) => void

    constructor(public fn: () => T) {
        if (activeEffectScope) {
            if (activeEffectScope.active) {
                activeEffectScope.effects.push(this)
            } else {
                // 作用域在延迟任务完成前已经卸载，退休任务不能重新收集依赖
                this.flags &= ~EffectFlags.ACTIVE
            }
        }
    }

    pause(): void {
        if (this.dirty) pausedQueueEffects.add(this)
        this.flags |= EffectFlags.PAUSED
    }

    resume(): void {
        if (this.flags & EffectFlags.PAUSED) {
            this.flags &= ~EffectFlags.PAUSED
            if (pausedQueueEffects.has(this)) {
                pausedQueueEffects.delete(this)
                this.trigger()
            }
        }
    }

    notify(): void {
        if (
            this.flags & EffectFlags.RUNNING && !(this.flags & EffectFlags.ALLOW_RECURSE)
        ) {
            return
        }
        if (!(this.flags & EffectFlags.NOTIFIED)) {
            batch(this)
        }
    }

    run(): T {
        if (!(this.flags & EffectFlags.ACTIVE)) {
            return this.fn()
        }

        this.flags |= EffectFlags.RUNNING
        cleanupEffect(this)
        prepareDeps(this)
        const prevEffect = activeSub
        const prevShouldTrack = shouldTrack
        activeSub = this
        shouldTrack = true

        try {
            return this.fn()
        } finally {
            if (__DEV__ && activeSub !== this) {
                warn('活动响应式副作用未正确恢复，请检查 Arrange 内部作用域切换')
            }
            if (this.flags & EffectFlags.ACTIVE) cleanupDeps(this)
            else {
                // 运行中的停止已退订，这里只恢复追踪上下文，不能再次减少订阅计数
                for (let link = this.deps; link; link = link.nextDep) {
                    link.dep.activeLink = link.prevActiveLink
                    link.prevActiveLink = undefined
                }
                this.deps = this.depsTail = undefined
            }
            activeSub = prevEffect
            shouldTrack = prevShouldTrack
            this.flags &= ~EffectFlags.RUNNING
        }
    }

    stop(): void {
        if (this.flags & EffectFlags.ACTIVE) {
            // 先退休，再清理；清理抛错或重入也不能重新启动已停止的副作用
            this.flags &= ~EffectFlags.ACTIVE
            pausedQueueEffects.delete(this)
            for (let link = this.deps; link; link = link.nextDep) {
                removeSub(link)
            }
            if (!(this.flags & EffectFlags.RUNNING)) this.deps = this.depsTail = undefined
            let cleanupFailed = false
            let cleanupError: unknown
            try { cleanupEffect(this) } catch (error) {
                cleanupFailed = true
                cleanupError = error
            }
            try { this.onStop?.() } catch (error) {
                if (cleanupFailed) throw new AggregateError([cleanupError, error], '响应式副作用停止时发生清理错误')
                throw error
            }
            if (cleanupFailed) throw cleanupError
        }
    }

    trigger(): void {
        if (this.flags & EffectFlags.PAUSED) {
            pausedQueueEffects.add(this)
        } else if (this.scheduler) {
            this.scheduler()
        } else {
            this.runIfDirty()
        }
    }

    runIfDirty(): void {
        if (this.flags & EffectFlags.PAUSED) {
            pausedQueueEffects.add(this)
            return
        }
        if (isDirty(this)) {
            this.run()
        }
    }

    get dirty(): boolean {
        return isDirty(this)
    }
}

let batchDepth = 0
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

export function batch(sub: Subscriber, isComputed = false): void {
    sub.flags |= EffectFlags.NOTIFIED
    if (isComputed) {
        sub.next = batchedComputed
        batchedComputed = sub
        return
    }
    sub.next = batchedSub
    batchedSub = sub
}

export function startBatch(): void {
    batchDepth++
}

export function endBatch(): void {
    // 只有最外层批次结束才派发，批次内多次写入不会重复执行订阅者
    if (--batchDepth > 0) {
        return
    }

    if (batchedComputed) {
        let e: Subscriber | undefined = batchedComputed
        batchedComputed = undefined
        while (e) {
            const next: Subscriber | undefined = e.next
            e.next = undefined
            e.flags &= ~EffectFlags.NOTIFIED
            e = next
        }
    }

    let error: unknown
    while (batchedSub) {
        let e: Subscriber | undefined = batchedSub
        batchedSub = undefined
        while (e) {
            const next: Subscriber | undefined = e.next
            e.next = undefined
            e.flags &= ~EffectFlags.NOTIFIED
            if (e.flags & EffectFlags.ACTIVE) {
                try {

                    (e as ReactiveEffect).trigger()
                } catch (err) {
                    if (!error) error = err
                }
            }
            e = next
        }
    }

    if (error) throw error
}

function prepareDeps(sub: Subscriber) {
    // 先标记旧依赖未访问，并保存嵌套执行前的活动连接
    for (let link = sub.deps; link; link = link.nextDep) {
        link.version = -1
        link.prevActiveLink = link.dep.activeLink
        link.dep.activeLink = link
    }
}

function cleanupDeps(sub: Subscriber) {
    // 本轮未重新读取的依赖退休，其余恢复嵌套执行前的连接
    let head
    let tail = sub.depsTail
    let link = tail
    while (link) {
        const prev = link.prevDep
        if (link.version === -1) {
            if (link === tail) tail = prev
            removeSub(link)
            removeDep(link)
        } else {
            head = link
        }

        link.dep.activeLink = link.prevActiveLink
        link.prevActiveLink = undefined
        link = prev
    }
    sub.deps = head
    sub.depsTail = tail
}

function isDirty(sub: Subscriber): boolean {
    for (let link = sub.deps; link; link = link.nextDep) {
        if (
            link.dep.version !== link.version || (link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version))
        ) {
            return true
        }
    }
    return false
}

export function refreshComputed(computed: ComputedRefImpl): undefined {
    if (
        computed.flags & EffectFlags.TRACKING && !(computed.flags & EffectFlags.DIRTY)
    ) {
        return
    }
    computed.flags &= ~EffectFlags.DIRTY

    if (computed.globalVersion === globalVersion) {
        return
    }
    computed.globalVersion = globalVersion

    // 已求值的常量与未失效依赖均复用缓存，外部不能通过隐藏标记强制失效
    if (computed.flags & EffectFlags.EVALUATED && (!computed.deps || !isDirty(computed))) {
        return
    }
    computed.flags |= EffectFlags.RUNNING

    const dep = computed.dep
    const prevSub = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = computed
    shouldTrack = true

    try {
        prepareDeps(computed)
        const value = computed.fn(computed._value)
        if (dep.version === 0 || hasChanged(value, computed._value)) {
            computed.flags |= EffectFlags.EVALUATED
            computed._value = value
            dep.version++
        }
    } catch (err) {
        dep.version++
        throw err
    } finally {
        activeSub = prevSub
        shouldTrack = prevShouldTrack
        cleanupDeps(computed)
        computed.flags &= ~EffectFlags.RUNNING
    }
}

function removeSub(link: Link, soft = false) {
    const { dep, prevSub, nextSub } = link
    if (prevSub) {
        prevSub.nextSub = nextSub
        link.prevSub = undefined
    }
    if (nextSub) {
        nextSub.prevSub = prevSub
        link.nextSub = undefined
    }
    if (__DEV__ && dep.subsHead === link) {
        dep.subsHead = nextSub
    }

    if (dep.subs === link) {
        dep.subs = prevSub

        if (!prevSub && dep.computed) {
            dep.computed.flags &= ~EffectFlags.TRACKING
            for (let l = dep.computed.deps; l; l = l.nextDep) {
                removeSub(l, true)
            }
        }
    }

    if (!soft && !--dep.sc && dep.map) {
        // 最后一个订阅退出后移除键对应的依赖，避免长期保存无人使用的键
        dep.map.delete(dep.key)
    }
}

function removeDep(link: Link) {
    const { prevDep, nextDep } = link
    if (prevDep) {
        prevDep.nextDep = nextDep
        link.prevDep = undefined
    }
    if (nextDep) {
        nextDep.prevDep = prevDep
        link.nextDep = undefined
    }
}

export function effect<T = any>(fn: () => T, options?: ReactiveEffectOptions): ReactiveEffectRunner<T> {
    if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
        fn = (fn as ReactiveEffectRunner).effect.fn
    }

    const e = new ReactiveEffect(fn)
    if (options) {
        extend(e, options)
    }
    try {
        e.run()
    } catch (err) {
        e.stop()
        throw err
    }
    const runner = e.run.bind(e) as ReactiveEffectRunner
    runner.effect = e
    return runner
}

export function stop(runner: ReactiveEffectRunner): void {
    runner.effect.stop()
}

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking(): void {
    trackStack.push(shouldTrack)
    shouldTrack = false
}

export function enableTracking(): void {
    trackStack.push(shouldTrack)
    shouldTrack = true
}

export function resetTracking(): void {
    const last = trackStack.pop()
    shouldTrack = last === undefined ? true : last
}

export function onEffectCleanup(fn: () => void, failSilently = false): void {
    if (activeSub instanceof ReactiveEffect) {
        activeSub.cleanup = fn
    } else if (__DEV__ && !failSilently) {
        warn(`onEffectCleanup() was called when there was no active effect` + ` to associate with.`)
    }
}

function cleanupEffect(e: ReactiveEffect) {
    const { cleanup } = e
    e.cleanup = undefined
    if (cleanup) {
        const prevSub = activeSub
        activeSub = undefined
        try {
            cleanup()
        } finally {
            activeSub = prevSub
        }
    }
}

export function batchUpdates<T>(work: () => T): T {
    startBatch()
    try { return work() } finally { endBatch() }
}
