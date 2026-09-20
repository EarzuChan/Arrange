import {computed, getCurrentScope, isRef, onScopeDispose, readonly, shallowReadonly, shallowRef} from "@arrange/vue-reactivity"
import {batchUpdates} from "@arrange/vue-reactivity"
import {watch} from "@arrange/vue-runtime-core"
import type {Ref} from "@arrange/vue-reactivity"

export type AnimationClock = {
    now: () => number
    requestFrame: (callback: (time: number) => void) => number
    cancelFrame: (handle: number) => void
}
export type AnimationTarget<T> = T | Ref<T> | (() => T)

export type Easing = (fraction: number) => number

export type AnimationSpec = Readonly<{kind: "tween"; durationMillis: number; delayMillis: number; easing: Easing}> | Readonly<{kind: "spring"; stiffness: number; dampingRatio: number; visibilityThreshold: number}> | Readonly<{kind: "snap"; delayMillis: number}>

export type AnimationArgs = {clock?: AnimationClock; animationSpec?: AnimationSpec; label?: string; finished?: () => void}

export type AnimatedRef<T> = Readonly<Ref<T>> & {readonly isRunning: Readonly<Ref<boolean>>; readonly label: string; stop: () => void}

export type Offset = Readonly<{x: number; y: number}>

export type Size = Readonly<{width: number; height: number}>

export type Rect = Offset & Size

function finite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${name}必须有限`)

    return value
}
function nonnegative(value: number, name: string): number {
    if (finite(value, name) < 0) throw new RangeError(`${name}不可非负喵`)

    return value
}

const nativeEasings = new WeakMap<Easing, readonly number[]>()

export const linearEasing: Easing = t => t

nativeEasings.set(linearEasing, [0, 0, 1, 1])

export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): Easing {
    for (const value of [x1, y1, x2, y2]) finite(value, "Bezier control point")

    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new RangeError("Bezier x must be in [0, 1]")

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

export function tween(args: {durationMillis?: number; delayMillis?: number; easing?: Easing} = {}): AnimationSpec {
    return Object.freeze({kind: "tween", durationMillis: nonnegative(args.durationMillis ?? 300, "duration"), delayMillis: nonnegative(args.delayMillis ?? 0, "delay"), easing: args.easing ?? easing.fastOutSlowIn})
}

export function spring(args: {stiffness?: number; dampingRatio?: number; visibilityThreshold?: number} = {}): AnimationSpec {
    const stiffness = nonnegative(args.stiffness ?? 400, "stiffness")
    const dampingRatio = nonnegative(args.dampingRatio ?? 1, "damping ratio")
    const visibilityThreshold = nonnegative(args.visibilityThreshold ?? 0.01, "threshold")
    if (!stiffness || !dampingRatio || !visibilityThreshold) throw new RangeError("Spring parameters must be positive")
    return Object.freeze({kind: "spring", stiffness, dampingRatio, visibilityThreshold})
}

export function snap(delayMillis = 0): AnimationSpec {
    return Object.freeze({kind: "snap", delayMillis: nonnegative(delayMillis, "delay")})
}

export const defaultAnimationClock: AnimationClock = Object.freeze({
    now: () => {
        if (typeof performance === "undefined" || typeof performance.now !== "function") throw new Error("Arrange animations require the native VBlank clock")
        return performance.now()
    },
    requestFrame: callback => {
        if (typeof requestAnimationFrame !== "function") throw new Error("Arrange animations require the native VBlank clock")
        return requestAnimationFrame(callback)
    },
    cancelFrame: handle => cancelAnimationFrame(handle),
})

export function createManualAnimationClock(): AnimationClock & {advanceBy: (deltaMillis: number) => void; readonly pendingFrames: number} {
    let time = 0, nextHandle = 1

    const frames = new Map<number, (time: number) => void>()

    return {
        now: () => time,
        requestFrame(callback) { const handle = nextHandle++; frames.set(handle, callback); return handle },
        cancelFrame(handle) { frames.delete(handle) },
        get pendingFrames() { return frames.size },
        advanceBy(deltaMillis) {
            time += nonnegative(deltaMillis, "frame delta")
            const callbacks = [...frames.values()]
            frames.clear()
            for (const callback of callbacks) callback(time)
        }
    }
}

export const animationStats = {activeAnimations: 0, sampledAnimations: 0, sampledFrames: 0}

type FrameParticipant = (time: number) => void

class AnimationTimeline {
    private participants = new Set<FrameParticipant>()
    private handle: number | undefined
    private sampling = false
    private completions: (() => void)[] = []
    constructor(readonly clock: AnimationClock) {}

    add(participant: FrameParticipant) {
        if (!this.participants.has(participant)) { this.participants.add(participant); animationStats.activeAnimations++ }
        this.request()
    }
    remove(participant: FrameParticipant) {
        if (this.participants.delete(participant)) animationStats.activeAnimations--
        if (!this.participants.size && this.handle !== undefined) {
            this.clock.cancelFrame(this.handle)
            this.handle = undefined
        }
    }
    finish(callback: () => void) {
        if (this.sampling) this.completions.push(callback)
        else callback()
    }
    private request() {
        if (this.sampling || this.handle !== undefined || !this.participants.size) return
        this.handle = this.clock.requestFrame(time => {
            this.handle = undefined
            this.sampling = true
            animationStats.sampledFrames++
            try {
                // Synchronous observers also see all channels at one timestamp.
                batchUpdates(() => {
                    for (const participant of [...this.participants]) if (this.participants.has(participant)) {
                        animationStats.sampledAnimations++
                        participant(time)
                    }
                    for (const complete of this.completions.splice(0)) complete()
                })
            } finally { this.completions.length = 0; this.sampling = false; this.request() }
        })
    }
}

const timelines = new WeakMap<AnimationClock, AnimationTimeline>()

function timeline(clock: AnimationClock) {
    let value = timelines.get(clock)
    if (!value) timelines.set(clock, value = new AnimationTimeline(clock))
    return value
}

function read<T>(target: AnimationTarget<T>): T {
    return isRef(target) ? target.value : typeof target === "function" ? (target as () => T)() : target
}

type Converter<T> = {to: (value: T) => number[]; from: (vector: number[]) => T}

const numberConverter: Converter<number> = {to: value => [finite(value, "animation value")], from: vector => vector[0]}

const arrayConverter: Converter<readonly number[]> = {to: value => value.map(item => finite(item, "animation channel")), from: vector => Object.freeze([...vector])}

const colorConverter: Converter<number> = {
    to(value) { finite(value, "color"); return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255] },
    from(vector) { const [a, r, g, b] = vector.map(value => Math.round(Math.max(0, Math.min(255, value)))); return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0 },
}

function objectConverter<T>(keys: readonly (keyof T)[]): Converter<T> {
    return {
        to: value => keys.map(key => key === 'width' || key === 'height'
            ? nonnegative(value[key] as number, String(key)) : finite(value[key] as number, String(key))),
        from: vector => Object.freeze(Object.fromEntries(keys.map((key, index) => [key,
            key === 'width' || key === 'height' ? Math.max(0, vector[index]) : vector[index],
        ]))) as T,
    }
}

const offsetConverter = objectConverter<Offset>(["x", "y"])

const sizeConverter = objectConverter<Size>(["width", "height"])

const rectConverter = objectConverter<Rect>(["x", "y", "width", "height"])

// Analytic oscillator: independent of frame rate, including long or skipped frames.
function springChannel(displacement: number, velocity: number, seconds: number, spec: Extract<AnimationSpec, {kind: "spring"}>): [number, number] {
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

function channel<T>(initial: T, converter: Converter<T>, args: AnimationArgs) {
    const clock = args.clock ?? defaultAnimationClock, scheduler = timeline(clock)
    let current = converter.to(initial), from = current, target = current, velocity = current.map(() => 0), initialVelocity = velocity
    const state = shallowRef(converter.from(current)) as Ref<T>, running = shallowRef(false)
    let startTime = 0, stopped = false
    const spec = args.animationSpec ?? spring()

    const sample = (time: number) => {
        const elapsed = Math.max(0, time - startTime)
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
            const progress = spec.kind === "tween" ? finite(spec.easing(fraction), "easing result") : 1
            done = fraction >= 1
            current = from.map((value, index) => value + (target[index] - value) * progress)
            velocity = current.map(() => 0)
        }
        if (done) { current = [...target]; velocity = target.map(() => 0); scheduler.remove(sample); running.value = false }
        state.value = converter.from(current)
        if (done) scheduler.finish(() => { if (!stopped && !running.value) args.finished?.() })
    }

    const retarget = (value: T, time = clock.now()) => {
        if (stopped) return
        const next = converter.to(value)
        if (next.length !== target.length) throw new RangeError("Animated number groups have a fixed length")
        if (next.every((item, index) => item === target[index])) return
        // Retarget from the last presented sample; preserve spring momentum.
        from = converter.to(state.value); target = next; initialVelocity = [...velocity]; startTime = time
        if (from.every((item, index) => item === target[index]) && velocity.every(value => value === 0)) return
        running.value = true
        if (spec.kind === "snap" && spec.delayMillis === 0 || spec.kind === "tween" && spec.durationMillis === 0 && spec.delayMillis === 0) sample(time)
        else scheduler.add(sample)
    }

    const output = shallowReadonly(state) as AnimatedRef<T>

    // Attach controls to the underlying ref before readonly proxying its reads.
    Object.defineProperties(state, {
        label: {value: args.label ?? ""},
        isRunning: {configurable: true, value: readonly(running)},
        stop: {configurable: true, value: () => { if (stopped) return; stopped = true; scheduler.remove(sample); running.value = false }},
    })

    return {output, retarget}
}

function animated<T>(target: AnimationTarget<T>, converter: Converter<T>, args: AnimationArgs): AnimatedRef<T> {
    const controller = channel(read(target), converter, args)
    const stopWatch = isRef(target) || typeof target === "function" ? watch(() => converter.to(read(target)), vector => controller.retarget(converter.from(vector)), {flush: "sync"}) : () => {}
    const stop = () => { stopWatch(); controller.output.stop() }
    if (getCurrentScope()) onScopeDispose(stop)
    // A proxy override keeps stop() responsible for the target subscription too.
    return new Proxy(controller.output, {get: (value, key, receiver) => key === "stop" ? stop : Reflect.get(value, key, receiver)})
}

export const animatedNumberAsRef = (target: AnimationTarget<number>, args: AnimationArgs = {}) => animated(target, numberConverter, args)

export const animatedDpAsRef = animatedNumberAsRef

export const animatedColorAsRef = (target: AnimationTarget<number>, args: AnimationArgs = {}) => animated(target, colorConverter, args)

export const animatedNumberArrayAsRef = (target: AnimationTarget<readonly number[]>, args: AnimationArgs = {}) => animated(target, arrayConverter, args)

export const animatedOffsetAsRef = (target: AnimationTarget<Offset>, args: AnimationArgs = {}) => animated(target, offsetConverter, args)

export const animatedSizeAsRef = (target: AnimationTarget<Size>, args: AnimationArgs = {}) => animated(target, sizeConverter, args)

export const animatedRectAsRef = (target: AnimationTarget<Rect>, args: AnimationArgs = {}) => animated(target, rectConverter, args)

export function createTransition<S>(target: AnimationTarget<S>, args: AnimationArgs = {}) {
    const clock = args.clock ?? defaultAnimationClock
    const currentState = shallowRef(read(target)) as Ref<S>
    const targetState = shallowRef(currentState.value) as Ref<S>
    const running = shallowRef(false)
    const children = new Map<string, {retarget: (state: S, time: number) => void; value: AnimatedRef<unknown>; stopMapping?: () => void}>()
    let stopped = false
    const settle = () => {
        running.value = [...children.values()].some(child => child.value.isRunning.value)
        if (!running.value) currentState.value = targetState.value
    }
    const register = <T>(label: string, mapping: (state: S) => T, converter: Converter<T>, childArgs: Omit<AnimationArgs, "clock"> = {}): AnimatedRef<T> => {
        if (stopped || children.has(label)) throw new Error(`Transition child '${label}' is retired or already registered`)
        const control = channel(mapping(currentState.value), converter, {...args, ...childArgs, label, clock, finished() { childArgs.finished?.(); settle() }})
        const mapped = computed(() => converter.to(mapping(targetState.value)))
        const child = {value: control.output as AnimatedRef<unknown>, retarget: (_state: S, time: number) => control.retarget(converter.from(mapped.value), time)}
        children.set(label, child)
        const stopMapping = watch(mapped, vector => {
            control.retarget(converter.from(vector), clock.now())
            settle()
        }, {flush: "sync"})
        children.get(label)!.stopMapping = stopMapping
        child.retarget(targetState.value, clock.now())
        const stop = () => { stopMapping(); control.output.stop(); children.delete(label); settle() }
        if (getCurrentScope()) onScopeDispose(stop)
        settle()
        return new Proxy(control.output, {get: (value, key, receiver) => key === "stop" ? stop : Reflect.get(value, key, receiver)})
    }
    const stopWatch = isRef(target) || typeof target === "function" ? watch(() => read(target), value => {
        const time = clock.now()
        batchUpdates(() => {
            targetState.value = value
            for (const child of children.values()) child.retarget(value, time)
            settle()
        })
    }, {flush: "sync"}) : () => {}
    const stop = () => {
        if (stopped) return
        stopped = true; stopWatch()
        for (const child of children.values()) { child.stopMapping?.(); child.value.stop() }
        children.clear(); running.value = false
    }
    if (getCurrentScope()) onScopeDispose(stop)
    return {
        currentState: readonly(currentState), targetState: readonly(targetState), isRunning: readonly(running), stop,
        animatedNumber: (label: string, map: (state: S) => number, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, numberConverter, childArgs),
        animatedDp: (label: string, map: (state: S) => number, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, numberConverter, childArgs),
        animatedColor: (label: string, map: (state: S) => number, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, colorConverter, childArgs),
        animatedNumberArray: (label: string, map: (state: S) => readonly number[], childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, arrayConverter, childArgs),
        animatedOffset: (label: string, map: (state: S) => Offset, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, offsetConverter, childArgs),
        animatedSize: (label: string, map: (state: S) => Size, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, sizeConverter, childArgs),
        animatedRect: (label: string, map: (state: S) => Rect, childArgs: Omit<AnimationArgs, "clock"> = {}) => register(label, map, rectConverter, childArgs),
    }
}

// Native measurement cannot call an arbitrary JS curve. Built-in and cubic Bezier
// curves carry a lossless numeric representation, rather than sampled approximations.
export function nativeAnimationSpec(spec: AnimationSpec): Readonly<Record<string, unknown>> {
    if (spec.kind !== "tween") return spec
    const points = nativeEasings.get(spec.easing)
    if (!points) throw new TypeError("animateContentSize requires a built-in or cubicBezier easing")
    return Object.freeze({kind: spec.kind, durationMillis: spec.durationMillis, delayMillis: spec.delayMillis, x1: points[0], y1: points[1], x2: points[2], y2: points[3]})
}

export const transition = createTransition
