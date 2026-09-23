import { animationScheduler } from './runtime/animationOwner.ts'
import type { FrameScheduler, FrameParticipant } from './runtime/scheduler.ts'
import { computed, getCurrentScope, isRef, onScopeDispose, readonly, shallowReadonly, shallowRef } from "@arrange/reactivity"
import { batchUpdates } from "@arrange/reactivity"
import { watch } from "./runtime/index.ts"
import type { Ref } from "@arrange/reactivity"

export type AnimationTarget<T> = T | Ref<T> | (() => T)

export type Easing = (fraction: number) => number

export type AnimationSpec = Readonly<{ kind: "tween"; durationMillis: number; delayMillis: number; easing: Easing }> | Readonly<{ kind: "spring"; stiffness: number; dampingRatio: number; visibilityThreshold: number }> | Readonly<{ kind: "snap"; delayMillis: number }>

export type AnimationArgs = { animationSpec?: AnimationSpec; label?: string; finished?: () => void }

export type RepeatMode = 'restart' | 'reverse'
export type InfiniteAnimationArgs = { animationSpec?: AnimationSpec; repeatMode?: RepeatMode }

export type AnimatedRef<T> = Readonly<Ref<T>> & { readonly isRunning: Readonly<Ref<boolean>>; readonly label: string; stop: () => void }

/** @arrangeFields offset */
export type Offset = Readonly<{ x: number; y: number }>

/** @arrangeFields size */
export type Size = Readonly<{ width: number; height: number }>

/** @arrangeFields rect */
export type Rect = Offset & Size

function finite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${name}必须有限`)

    return value
}
function nonnegative(value: number, name: string): number {
    if (finite(value, name) < 0) throw new RangeError(`${name}必须非负`)

    return value
}

const nativeEasings = new WeakMap<Easing, readonly number[]>()

export const linearEasing: Easing = t => t

nativeEasings.set(linearEasing, [0, 0, 1, 1])

export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): Easing {
    for (const value of [x1, y1, x2, y2]) finite(value, "贝塞尔控制点")

    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new RangeError("贝塞尔横坐标必须在 [0, 1] 之间")

    const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3

    const evaluate: Easing = fraction => {
        if (fraction <= 0 || fraction >= 1) return Math.max(0, Math.min(1, fraction))

        let low = 0, high = 1

        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2
            if (curve(mid, x1, x2) < fraction) low = mid
            else high = mid
        }

        return curve((low + high) / 2, y1, y2)
    }

    nativeEasings.set(evaluate, [x1, y1, x2, y2])
    return evaluate
}
export const easing = Object.freeze({
    linear: linearEasing,
    fastOutSlowIn: cubicBezierEasing(0.4, 0, 0.2, 1),
    fastOutLinearIn: cubicBezierEasing(0.4, 0, 1, 1),
    linearOutSlowIn: cubicBezierEasing(0, 0, 0.2, 1),
    cubicBezier: cubicBezierEasing,
})

export function tween(args: { durationMillis?: number; delayMillis?: number; easing?: Easing } = {}): AnimationSpec {
    return Object.freeze({ kind: "tween", durationMillis: nonnegative(args.durationMillis ?? 300, "duration"), delayMillis: nonnegative(args.delayMillis ?? 0, "delay"), easing: args.easing ?? easing.fastOutSlowIn })
}

export function spring(args: { stiffness?: number; dampingRatio?: number; visibilityThreshold?: number } = {}): AnimationSpec {
    const stiffness = nonnegative(args.stiffness ?? 400, "stiffness")
    const dampingRatio = nonnegative(args.dampingRatio ?? 1, "damping ratio")
    const visibilityThreshold = nonnegative(args.visibilityThreshold ?? 0.01, "threshold")
    if (!stiffness || !dampingRatio || !visibilityThreshold) throw new RangeError("弹簧参数必须为正数")
    return Object.freeze({ kind: "spring", stiffness, dampingRatio, visibilityThreshold })
}

export function snap(delayMillis = 0): AnimationSpec {
    return Object.freeze({ kind: "snap", delayMillis: nonnegative(delayMillis, "delay") })
}

export const animationStats = { activeAnimations: 0, sampledAnimations: 0, sampledFrames: 0 }

type FrameParticipantCallback = (time: number) => void

class AnimationTimeline implements FrameParticipant {
    private readonly participants = new Map<FrameParticipantCallback, () => boolean>()
    private readonly completions: (() => void)[] = []

    constructor(readonly owner: FrameScheduler) { }

    active = () => [...this.participants.values()].some(active => active())

    sample(time: number): void {
        animationStats.sampledFrames++
        batchUpdates(() => {
            for (const [sample, active] of [...this.participants]) if (this.participants.has(sample) && active()) {
                animationStats.sampledAnimations++
                sample(time)
            }
        })
        for (const complete of this.completions.splice(0)) complete()
    }

    add(sample: FrameParticipantCallback, active: () => boolean): void {
        if (this.participants.has(sample)) return
        if (!this.participants.size) this.owner.add(this)
        this.participants.set(sample, active)
        animationStats.activeAnimations++
        this.owner.wake()
    }

    remove(sample: FrameParticipantCallback): void {
        if (!this.participants.delete(sample)) return
        animationStats.activeAnimations--
        if (!this.participants.size) this.owner.remove(this)
    }

    finish(callback: () => void): void { this.completions.push(callback) }
}

const timelines = new WeakMap<FrameScheduler, AnimationTimeline>()
function timeline(owner: FrameScheduler) {
    let value = timelines.get(owner)
    if (!value) timelines.set(owner, value = new AnimationTimeline(owner))
    return value
}

function read<T>(target: AnimationTarget<T>): T {
    return isRef(target) ? target.value : typeof target === "function" ? (target as () => T)() : target
}

type Converter<T> = { to: (value: T) => number[]; from: (vector: number[]) => T }

const numberConverter: Converter<number> = { to: value => [finite(value, "动画数值")], from: vector => vector[0] }

const arrayConverter: Converter<readonly number[]> = { to: value => value.map(item => finite(item, "动画通道")), from: vector => Object.freeze([...vector]) }

const colorConverter: Converter<number> = {
    to(value) {
        finite(value, "color")
        return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
    },
    from(vector) {
        const [a, r, g, b] = vector.map(value => Math.round(Math.max(0, Math.min(255, value))))
        return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0
    },
}

function objectConverter<T>(keys: readonly (keyof T)[]): Converter<T> {
    return {
        to: value => keys.map(key => key === 'width' || key === 'height' ? nonnegative(value[key] as number, String(key)) : finite(value[key] as number, String(key))),
        from: vector => Object.freeze(Object.fromEntries(keys.map((key, index) => [key,
            key === 'width' || key === 'height' ? Math.max(0, vector[index]) : vector[index],
        ]))) as T,
    }
}

const offsetConverter = objectConverter<Offset>(["x", "y"])

const sizeConverter = objectConverter<Size>(["width", "height"])

const rectConverter = objectConverter<Rect>(["x", "y", "width", "height"])

// 解析振子独立于帧率，跳帧后按实际经过的时间采样
function springChannel(displacement: number, velocity: number, seconds: number, spec: Extract<AnimationSpec, { kind: "spring" }>): [number, number] {
    const omega = Math.sqrt(spec.stiffness), zeta = spec.dampingRatio

    if (zeta < 1) {
        const decay = zeta * omega, frequency = omega * Math.sqrt(1 - zeta * zeta)
        const b = (velocity + decay * displacement) / frequency
        const cos = Math.cos(frequency * seconds), sin = Math.sin(frequency * seconds), envelope = Math.exp(-decay * seconds)
        return [envelope * (displacement * cos + b * sin), envelope * ((b * frequency - decay * displacement) * cos - (displacement * frequency + decay * b) * sin)]
    }

    if (Math.abs(zeta - 1) < 1e-6) {
        const b = velocity + omega * displacement, envelope = Math.exp(-omega * seconds)
        return [envelope * (displacement + b * seconds), envelope * (velocity - omega * b * seconds)]
    }

    const root = Math.sqrt(zeta * zeta - 1), r1 = -omega * (zeta - root), r2 = -omega * (zeta + root)
    const a = (velocity - r2 * displacement) / (r1 - r2), b = displacement - a
    return [a * Math.exp(r1 * seconds) + b * Math.exp(r2 * seconds), a * r1 * Math.exp(r1 * seconds) + b * r2 * Math.exp(r2 * seconds)]
}

function channel<T>(initial: T, converter: Converter<T>, args: AnimationArgs, infinite?: { target: T; repeatMode: RepeatMode }) {
    const clock = animationScheduler(), scheduler = timeline(clock)
    const scope = getCurrentScope()
    let current = converter.to(initial), from = current, target = infinite ? converter.to(infinite.target) : current, velocity = current.map(() => 0), initialVelocity = velocity
    const state = shallowRef(converter.from(current)) as Ref<T>, running = shallowRef(false)
    let startTime = 0, stopped = false
    let pausedAt = 0
    let resumed = false
    const spec = args.animationSpec ?? spring()

    const sample = (time: number) => {
        if (resumed) {
            startTime += time - pausedAt
            resumed = false
        }
        const elapsed = Math.max(0, time - startTime)
        if (infinite) {
            const spec = args.animationSpec as Extract<AnimationSpec, { kind: 'tween' }>
            const cycleDuration = spec.delayMillis + spec.durationMillis
            const cycle = Math.floor(elapsed / cycleDuration)
            const cycleTime = elapsed - cycle * cycleDuration
            if (cycleTime < spec.delayMillis) return
            let progress = Math.min(1, (cycleTime - spec.delayMillis) / spec.durationMillis)
            if (infinite.repeatMode === 'reverse' && cycle % 2 === 1) progress = 1 - progress
            progress = finite(spec.easing(progress), "缓动结果")
            current = from.map((value, index) => value + (target[index] - value) * progress)
            state.value = converter.from(current)
            return
        }
        let done = true
        if (spec.kind === "spring") {
            current = from.map((value, index) => {
                const [delta, speed] = springChannel(value - target[index], initialVelocity[index], elapsed / 1000, spec)
                velocity[index] = speed
                if (Math.abs(delta) > spec.visibilityThreshold || Math.abs(speed) > spec.visibilityThreshold * 10) done = false
                return target[index] + delta
            })
        } else {
            if (elapsed < spec.delayMillis) return
            const duration = spec.kind === "tween" ? spec.durationMillis : 0
            const fraction = duration ? Math.min(1, (elapsed - spec.delayMillis) / duration) : 1
            const progress = spec.kind === "tween" ? finite(spec.easing(fraction), "缓动结果") : 1
            done = fraction >= 1
            current = from.map((value, index) => value + (target[index] - value) * progress)
            velocity = current.map(() => 0)
        }
        if (done) {
            current = [...target]
            velocity = target.map(() => 0)
            scheduler.remove(sample)
            running.value = false
        }
        state.value = converter.from(current)
        if (done) scheduler.finish(() => { if (!stopped && !running.value) args.finished?.() })
    }

    const retarget = (value: T, time = clock.now()) => {
        if (stopped) return
        const next = converter.to(value)
        if (next.length !== target.length) throw new RangeError("动画数值数组的长度不能改变")
        if (next.every((item, index) => item === target[index])) return
        // 从最近采样值重定向，保留弹簧动量
        from = converter.to(state.value)
        target = next
        initialVelocity = [...velocity]
        startTime = time
        resumed = false
        if (from.every((item, index) => item === target[index]) && velocity.every(value => value === 0)) return
        running.value = true
        scheduler.add(sample, () => !scope || scope.active && !scope.paused)
    }

    if (infinite) {
        const spec = args.animationSpec
        if (!spec || spec.kind !== 'tween' || !spec.durationMillis) throw new RangeError('无限动画需要 durationMillis 大于 0 的 tween')
        if (target.length !== current.length) throw new RangeError('动画数值数组的长度不能改变')
        startTime = clock.now()
        running.value = true
        scheduler.add(sample, () => !scope || scope.active && !scope.paused)
    }

    const pause = () => {
        pausedAt = clock.now()
        clock.refresh()
    }
    const resume = () => {
        resumed = true
        if (running.value) clock.wake()
    }
    scope?.pauseCallbacks.add(pause)
    scope?.resumeCallbacks.add(resume)
    if (scope) onScopeDispose(() => {
        scope.pauseCallbacks.delete(pause)
        scope.resumeCallbacks.delete(resume)
        scheduler.remove(sample)
    })

    const output = shallowReadonly(state) as AnimatedRef<T>

    // 控制成员注册到原 Ref，由只读代理保护值读取
    Object.defineProperties(state, {
        label: { value: args.label ?? "" },
        isRunning: { configurable: true, value: readonly(running) },
        stop: {
            configurable: true, value: () => {
                if (stopped) return
                stopped = true
                scheduler.remove(sample)
                running.value = false
            }
        },
    })

    return { output, retarget }
}

function animated<T>(target: AnimationTarget<T>, converter: Converter<T>, args: AnimationArgs): AnimatedRef<T> {
    const controller = channel(read(target), converter, args)
    const stopWatch = isRef(target) || typeof target === "function" ? watch(() => converter.to(read(target)), vector => controller.retarget(converter.from(vector)), { flush: "sync" }) : () => { }
    const stop = () => {
        stopWatch()
        controller.output.stop()
    }
    if (getCurrentScope()) onScopeDispose(stop)
    // 停止通道时一并取消目标订阅
    return new Proxy(controller.output, { get: (value, key, receiver) => key === "stop" ? stop : Reflect.get(value, key, receiver) })
}

export const animatedNumberAsRef = (target: AnimationTarget<number>, args: AnimationArgs = {}) => animated(target, numberConverter, args)

/** @arrangeArguments dp
 * @arrangeResult dp */
export const animatedDpAsRef = animatedNumberAsRef

/** @arrangeArguments color
 * @arrangeResult color */
export const animatedColorAsRef = (target: AnimationTarget<number>, args: AnimationArgs = {}) => animated(target, colorConverter, args)

export const animatedNumberArrayAsRef = (target: AnimationTarget<readonly number[]>, args: AnimationArgs = {}) => animated(target, arrayConverter, args)

/** @arrangeArguments offset */
export const animatedOffsetAsRef = (target: AnimationTarget<Offset>, args: AnimationArgs = {}) => animated(target, offsetConverter, args)

/** @arrangeArguments size */
export const animatedSizeAsRef = (target: AnimationTarget<Size>, args: AnimationArgs = {}) => animated(target, sizeConverter, args)

/** @arrangeArguments rect */
export const animatedRectAsRef = (target: AnimationTarget<Rect>, args: AnimationArgs = {}) => animated(target, rectConverter, args)

export function createTransition<S>(target: AnimationTarget<S>, args: AnimationArgs = {}) {
    const clock = animationScheduler()
    const currentState = shallowRef(read(target)) as Ref<S>
    const targetState = shallowRef(currentState.value) as Ref<S>
    const running = shallowRef(false)
    const children = new Map<string, { retarget: (state: S, time: number) => void; value: AnimatedRef<unknown>; stopMapping?: () => void }>()
    let stopped = false
    const settle = () => {
        running.value = [...children.values()].some(child => child.value.isRunning.value)
        if (!running.value) currentState.value = targetState.value
    }
    const register = <T>(label: string, mapping: (state: S) => T, converter: Converter<T>, childArgs: AnimationArgs = {}): AnimatedRef<T> => {
        if (stopped || children.has(label)) throw new Error(`Transition 子通道 '${label}' 已退休或重复注册`)
        const control = channel(mapping(currentState.value), converter, {
            ...args, ...childArgs, label, finished() {
                childArgs.finished?.()
                settle()
            }
        })
        const mapped = computed(() => converter.to(mapping(targetState.value)))
        const child = { value: control.output as AnimatedRef<unknown>, retarget: (_state: S, time: number) => control.retarget(converter.from(mapped.value), time) }
        children.set(label, child)
        const stopMapping = watch(mapped, vector => {
            control.retarget(converter.from(vector), clock.now())
            settle()
        }, { flush: "sync" })
        children.get(label)!.stopMapping = stopMapping
        child.retarget(targetState.value, clock.now())
        const stop = () => {
            stopMapping()
            control.output.stop()
            children.delete(label)
            settle()
        }
        if (getCurrentScope()) onScopeDispose(stop)
        settle()
        return new Proxy(control.output, { get: (value, key, receiver) => key === "stop" ? stop : Reflect.get(value, key, receiver) })
    }
    const stopWatch = isRef(target) || typeof target === "function" ? watch(() => read(target), value => {
        const time = clock.now()
        batchUpdates(() => {
            targetState.value = value
            for (const child of children.values()) child.retarget(value, time)
            settle()
        })
    }, { flush: "sync" }) : () => { }
    const stop = () => {
        if (stopped) return
        stopped = true
        stopWatch()
        for (const child of children.values()) {
            child.stopMapping?.()
            child.value.stop()
        }
        children.clear()
        running.value = false
    }
    if (getCurrentScope()) onScopeDispose(stop)
    return {
        currentState: readonly(currentState), targetState: readonly(targetState), isRunning: readonly(running), stop,
        animatedNumber: (label: string, map: (state: S) => number, childArgs: AnimationArgs = {}) => register(label, map, numberConverter, childArgs),
        /** @arrangeArguments none dp
         * @arrangeResult dp */
        animatedDp: (label: string, map: (state: S) => number, childArgs: AnimationArgs = {}) => register(label, map, numberConverter, childArgs),
        /** @arrangeArguments none color
         * @arrangeResult color */
        animatedColor: (label: string, map: (state: S) => number, childArgs: AnimationArgs = {}) => register(label, map, colorConverter, childArgs),
        animatedNumberArray: (label: string, map: (state: S) => readonly number[], childArgs: AnimationArgs = {}) => register(label, map, arrayConverter, childArgs),
        /** @arrangeArguments none offset */
        animatedOffset: (label: string, map: (state: S) => Offset, childArgs: AnimationArgs = {}) => register(label, map, offsetConverter, childArgs),
        /** @arrangeArguments none size */
        animatedSize: (label: string, map: (state: S) => Size, childArgs: AnimationArgs = {}) => register(label, map, sizeConverter, childArgs),
        /** @arrangeArguments none rect */
        animatedRect: (label: string, map: (state: S) => Rect, childArgs: AnimationArgs = {}) => register(label, map, rectConverter, childArgs),
    }
}

export function createInfiniteTransition(args: { label?: string } = {}) {
    const children = new Map<string, AnimatedRef<unknown>>()
    const running = shallowRef(false)
    let stopped = false

    const register = <T>(label: string, initial: T, target: T, converter: Converter<T>, childArgs: InfiniteAnimationArgs = {}): AnimatedRef<T> => {
        if (stopped || children.has(label)) throw new Error(`无限 Transition 子通道 '${label}' 已退休或重复注册`)
        const animationSpec = childArgs.animationSpec ?? tween()
        if (animationSpec.kind !== 'tween' || !animationSpec.durationMillis) throw new RangeError('无限动画需要 durationMillis 大于 0 的 tween')
        const control = channel(initial, converter, { animationSpec, label: `${args.label ? `${args.label}/` : ''}${label}` }, {
            target, repeatMode: childArgs.repeatMode ?? 'restart',
        })
        let retired = false
        const retire = () => {
            if (retired) return
            retired = true
            control.output.stop()
            children.delete(label)
            running.value = children.size > 0
        }
        const value = new Proxy(control.output, { get: (output, key, receiver) => key === 'stop' ? retire : Reflect.get(output, key, receiver) })
        children.set(label, value as AnimatedRef<unknown>)
        running.value = true
        if (getCurrentScope()) onScopeDispose(retire)
        return value
    }

    const stop = () => {
        if (stopped) return
        stopped = true
        for (const child of [...children.values()]) child.stop()
        running.value = false
    }
    if (getCurrentScope()) onScopeDispose(stop)

    return {
        isRunning: readonly(running),
        stop,
        animatedNumber: (label: string, initial: number, target: number, childArgs?: InfiniteAnimationArgs) => register(label, initial, target, numberConverter, childArgs),
        /** @arrangeArguments none dp
         * @arrangeResult dp */
        animatedDp: (label: string, initial: number, target: number, childArgs?: InfiniteAnimationArgs) => register(label, initial, target, numberConverter, childArgs),
        /** @arrangeArguments none color
         * @arrangeResult color */
        animatedColor: (label: string, initial: number, target: number, childArgs?: InfiniteAnimationArgs) => register(label, initial, target, colorConverter, childArgs),
    }
}

export const infiniteTransition = createInfiniteTransition

// 原生测量不调用任意 JS 曲线，内建及贝塞尔曲线携带无损数值描述
export function nativeAnimationSpec(spec: AnimationSpec): Readonly<Record<string, unknown>> {
    if (spec.kind !== "tween") return spec
    const points = nativeEasings.get(spec.easing)
    if (!points) throw new TypeError("animateContentSize 需要内建或贝塞尔缓动曲线")
    return Object.freeze({ kind: spec.kind, durationMillis: spec.durationMillis, delayMillis: spec.delayMillis, x1: points[0], y1: points[1], x2: points[2], y2: points[3] })
}

export const transition = createTransition
