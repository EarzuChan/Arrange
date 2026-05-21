import {isRef, ref} from "@arrange/vue-reactivity"
import {watch} from "@arrange/vue-runtime-core"
import type {Ref, WatchStopHandle} from "@arrange/vue-runtime-core"

type AnimationFrameHandle = ReturnType<typeof requestAnimationFrame> | ReturnType<typeof setTimeout> | number

type AnimationClock = {
    now: () => number
    requestFrame: (callback: (time: number) => void) => AnimationFrameHandle
    cancelFrame: (handle: AnimationFrameHandle) => void
}

type ManualAnimationClock = AnimationClock & {
    advanceBy: (deltaMillis: number) => void
}

type Target<T> = T | Ref<T> | (() => T)

type AnimationArgs = {
    clock?: AnimationClock
    durationMillis?: number
    easing?: (fraction: number) => number
}

export type AnimatedRef<T> = Ref<T> & {stop: () => void}

function defaultNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now()
    if (typeof requestAnimationFrame === "function" || typeof setTimeout === "function") return Date.now()
    return 0
}

export const linearEasing = (fraction: number): number => fraction

export const defaultAnimationClock: AnimationClock = Object.freeze({
    now: defaultNow,
    requestFrame(callback: (time: number) => void): AnimationFrameHandle {
        if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback)
        if (typeof setTimeout === "function") return setTimeout(() => callback(defaultNow()), 16)
        throw new Error("Arrange animation requires a native frame clock or a test clock")
    },
    cancelFrame(handle: AnimationFrameHandle): void {
        if (typeof cancelAnimationFrame === "function" && typeof handle === "number") cancelAnimationFrame(handle)
        else if (typeof clearTimeout === "function") clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
})

export function createManualAnimationClock(): ManualAnimationClock {
    let time = 0
    let nextHandle = 1
    const frames = new Map<number, (time: number) => void>()
    return {
        now: () => time,
        requestFrame(callback: (time: number) => void): number {
            const handle = nextHandle++
            frames.set(handle, callback)
            return handle
        },
        cancelFrame(handle: AnimationFrameHandle): void {
            frames.delete(Number(handle))
        },
        advanceBy(deltaMillis: number): void {
            time += deltaMillis
            const callbacks = [...frames.values()]
            frames.clear()
            for (const callback of callbacks) callback(time)
        },
    }
}

function readTarget<T>(target: Target<T>): T {
    return isRef(target) ? target.value : typeof target === "function" ? (target as () => T)() : target
}

function watchTarget<T>(target: Target<T>, callback: (value: T) => void): WatchStopHandle {
    if (isRef(target) || typeof target === "function") return watch(target as Ref<T> | (() => T), callback, {flush: "sync"})
    return () => {}
}

function animateNumberAsState(
    target: Target<number>,
    args: AnimationArgs = {},
    interpolate: (from: number, to: number, fraction: number) => number = (from, to, fraction) => from + (to - from) * fraction,
): AnimatedRef<number> {
    const clock = args.clock ?? defaultAnimationClock
    const durationMillis = Math.max(0, args.durationMillis ?? 300)
    const easing = args.easing ?? linearEasing
    const state = ref(Number(readTarget(target)) || 0) as AnimatedRef<number>

    let frameHandle: AnimationFrameHandle | 0 = 0
    let from = state.value
    let to = state.value
    let startTime = clock.now()

    const cancel = (): void => {
        if (frameHandle) clock.cancelFrame(frameHandle)
        frameHandle = 0
    }

    const step = (): void => {
        const elapsed = clock.now() - startTime
        const fraction = durationMillis <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / durationMillis))
        state.value = interpolate(from, to, easing(fraction))
        if (fraction < 1) frameHandle = clock.requestFrame(step)
        else frameHandle = 0
    }

    const start = (nextTarget: number): void => {
        const next = Number(nextTarget) || 0
        cancel()
        from = state.value
        to = next
        startTime = clock.now()
        if (durationMillis === 0 || from === to) {
            state.value = to
            return
        }
        frameHandle = clock.requestFrame(step)
    }

    const stopWatch = watchTarget(target, start)
    Object.defineProperty(state, "stop", {
        configurable: true,
        value() {
            cancel()
            stopWatch()
        },
    })
    return state
}

function interpolateColor(from: number, to: number, fraction: number): number {
    const fa = (from >>> 24) & 0xff
    const fr = (from >>> 16) & 0xff
    const fg = (from >>> 8) & 0xff
    const fb = from & 0xff
    const ta = (to >>> 24) & 0xff
    const tr = (to >>> 16) & 0xff
    const tg = (to >>> 8) & 0xff
    const tb = to & 0xff
    const channel = (a: number, b: number): number => Math.round(a + (b - a) * fraction) & 0xff
    return ((channel(fa, ta) << 24) | (channel(fr, tr) << 16) | (channel(fg, tg) << 8) | channel(fb, tb)) >>> 0
}

export function animateFloatAsState(targetValue: Target<number>, args: AnimationArgs = {}): AnimatedRef<number> {
    return animateNumberAsState(targetValue, args)
}

export function animateDpAsState(targetValue: Target<number>, args: AnimationArgs = {}): AnimatedRef<number> {
    return animateNumberAsState(targetValue, args)
}

export function animateColorAsState(targetValue: Target<number>, args: AnimationArgs = {}): AnimatedRef<number> {
    return animateNumberAsState(targetValue, args, interpolateColor)
}

export function updateTransition<T>(targetState: Target<T>, args: AnimationArgs = {}) {
    return {
        targetState,
        animateFloat(_label: string, targetForState: (state: T) => number, animationArgs: AnimationArgs = {}): AnimatedRef<number> {
            const target = () => targetForState(readTarget(targetState))
            return animateFloatAsState(target, {...args, ...animationArgs})
        },
        animateDp(_label: string, targetForState: (state: T) => number, animationArgs: AnimationArgs = {}): AnimatedRef<number> {
            const target = () => targetForState(readTarget(targetState))
            return animateDpAsState(target, {...args, ...animationArgs})
        },
        animateColor(_label: string, targetForState: (state: T) => number, animationArgs: AnimationArgs = {}): AnimatedRef<number> {
            const target = () => targetForState(readTarget(targetState))
            return animateColorAsState(target, {...args, ...animationArgs})
        },
    }
}
