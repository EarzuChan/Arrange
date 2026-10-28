import type { Density } from './density.ts'
import { dragStateInternal, type DragModifiers } from './gesture.ts'

type NativeHandlers = Readonly<Record<string, (event: never) => void>>

// 原生事件载荷是 PX；这里换算为 DP 并按回调缓存包装，事件槽因此不随重排更换
export class EventAdapters {
    private readonly pointers = new WeakMap<object, (event: { type?: string; x: number; y: number; modifiers: unknown }) => unknown>()
    private readonly wheels = new WeakMap<object, (event: { deltaX: number; deltaY: number; modifiers: unknown }) => unknown>()
    private readonly drags = new WeakMap<object, { input: Readonly<Record<string, unknown>>; native: NativeHandlers }>()

    constructor(private readonly density: Density) { }

    // 按修饰种类适配回调字段；无需适配时原样返回
    adapt(type: string, value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
        if (type === 'onContextClick' || type === 'pointerInput') return { ...value, callback: this.pointer(value.callback) }
        if (type === 'onWheel') return { ...value, callback: this.wheel(value.callback) }
        if (type === 'draggable') return this.draggable(value)
        return value
    }

    // 指针事件为受体本地 PX；pointerInput 事件另带 type
    private pointer(callback: unknown): unknown {
        if (typeof callback !== 'function') return callback
        let wrapped = this.pointers.get(callback)
        if (!wrapped) {
            wrapped = event => callback(Object.freeze({ ...'type' in event ? { type: event.type } : {}, xDp: this.density.pxToDp(event.x), yDp: this.density.pxToDp(event.y), modifiers: Object.freeze(event.modifiers) }))
            this.pointers.set(callback, wrapped)
        }
        return wrapped
    }

    private wheel(callback: unknown): unknown {
        if (typeof callback !== 'function') return callback
        let wrapped = this.wheels.get(callback)
        if (!wrapped) {
            wrapped = event => callback(Object.freeze({ deltaXDp: this.density.pxToDp(event.deltaX), deltaYDp: this.density.pxToDp(event.deltaY), modifiers: Object.freeze(event.modifiers) }))
            this.wheels.set(callback, wrapped)
        }
        return wrapped
    }

    // 每个手势状态一组稳定的原生回调，回调内读取最新声明
    private draggable(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
        const state = input.state as object
        let entry = this.drags.get(state)
        if (!entry) {
            const internal = dragStateInternal(state)
            const dp = (value: number) => this.density.pxToDp(value)
            const created: { input: Readonly<Record<string, unknown>>; native: NativeHandlers } = {
                input,
                native: Object.freeze({
                    onDelta: (event: { deltaX: number; deltaY: number; modifiers: DragModifiers }) => {
                        const orientation = created.input.orientation
                        internal.delta(dp(orientation === 'vertical' ? event.deltaY : event.deltaX), orientation === 'both' ? dp(event.deltaY) : 0, Object.freeze(event.modifiers))
                    },
                    onStart: (event: { x: number; y: number; width: number; height: number; modifiers: DragModifiers }) => {
                        internal.setDragging(true)
                        const callback = created.input.onDragStarted as ((start: unknown) => void) | undefined
                        callback?.(Object.freeze({ xDp: dp(event.x), yDp: dp(event.y), widthDp: dp(event.width), heightDp: dp(event.height), modifiers: Object.freeze(event.modifiers) }))
                    },
                    onStop: (event: { velocity: number; cancelled: boolean }) => {
                        internal.setDragging(false)
                        const callback = created.input.onDragStopped as ((stop: unknown) => void) | undefined
                        callback?.(Object.freeze({ velocityDp: dp(event.velocity), cancelled: event.cancelled }))
                    },
                }),
            }
            entry = created
            this.drags.set(state, entry)
        }
        entry.input = input
        const resolved: Record<string, unknown> = { enabled: input.enabled ?? true, axis: input.orientation, startImmediately: input.startImmediately ?? false, pointerLock: input.pointerLock ?? false, ...entry.native }
        if (input.interaction) resolved.interaction = input.interaction
        return resolved
    }
}
