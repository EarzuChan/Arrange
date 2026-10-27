import { reactive, batchUpdates } from "@arrange/reactivity"
import type { KeyModifiers } from './modifier.ts'

export type DragModifiers = KeyModifiers
export type DragStart = Readonly<{ xDp: number; yDp: number; widthDp: number; heightDp: number; modifiers: DragModifiers }>
export type DragStop = Readonly<{ velocityDp: number; cancelled: boolean }>
export type DraggableOptions = { enabled?: boolean; startImmediately?: boolean; pointerLock?: boolean; onDragStarted?: (start: DragStart) => void; onDragStopped?: (stop: DragStop) => void; interactionState?: InteractionState }

export interface InteractionState {
    readonly hovered: boolean
    readonly pressed: boolean
    readonly focused: boolean
    readonly dragged: boolean
}

// 原生按节点汇总悬停、按下、拖动中并在变化时回写；焦点来自同节点的焦点观察
export interface InteractionStateInternal {
    readonly pointer: (event: { hovered: boolean; pressed: boolean; dragged: boolean }) => void
    readonly focus: (state: { isFocused: boolean }) => void
}

const interactionInternals = new WeakMap<object, InteractionStateInternal>()

export function interactionStateInternal(state: InteractionState): InteractionStateInternal {
    const internal = interactionInternals.get(state)
    if (!internal) throw new TypeError('interactionState 需要 createInteractionState() 创建的状态')
    return internal
}

export function createInteractionState(): InteractionState {
    const store = reactive({ hovered: false, pressed: false, focused: false, dragged: false })
    const state = Object.freeze({
        get hovered() { return store.hovered },
        get pressed() { return store.pressed },
        get focused() { return store.focused },
        get dragged() { return store.dragged },
    })
    interactionInternals.set(state, Object.freeze({
        pointer: (event: { hovered: boolean; pressed: boolean; dragged: boolean }) => batchUpdates(() => {
            store.hovered = event.hovered
            store.pressed = event.pressed
            store.dragged = event.dragged
        }),
        focus: (focus: { isFocused: boolean }) => { store.focused = focus.isFocused },
    }))
    return state
}

export interface DraggableState { readonly isDragging: boolean }
export interface Draggable2DState { readonly isDragging: boolean }

// 手势状态的内部入口：位移消费者与拖动中标记，只给 Modifier 解析使用
export interface DragStateInternal {
    readonly twoDimensional: boolean
    delta(xDp: number, yDp: number, modifiers: DragModifiers): void
    setDragging(value: boolean): void
}

const internals = new WeakMap<object, DragStateInternal>()

export function dragStateInternal(state: object): DragStateInternal {
    const internal = internals.get(state)
    if (!internal) throw new TypeError('draggable 需要 createDraggableState() 或 createDraggable2DState() 创建的状态')
    return internal
}

function createDragState(twoDimensional: boolean, delta: DragStateInternal['delta']): DraggableState {
    const store = reactive({ isDragging: false })
    const state = Object.freeze({ get isDragging() { return store.isDragging } })
    internals.set(state, { twoDimensional, delta, setDragging: value => { store.isDragging = value } })
    return state
}

// 状态在 setup 中创建一次；位移单位为 dp，只交付所选轴的分量
export function createDraggableState(onDelta: (deltaDp: number, modifiers: DragModifiers) => void): DraggableState {
    if (typeof onDelta !== 'function') throw new TypeError('createDraggableState 需要位移回调')
    // 单轴状态由 Modifier 决定方向，解析时只传入所选轴分量
    return createDragState(false, (xDp, _yDp, modifiers) => onDelta(xDp, modifiers))
}

export function createDraggable2DState(onDelta: (delta: Readonly<{ xDp: number; yDp: number }>, modifiers: DragModifiers) => void): Draggable2DState {
    if (typeof onDelta !== 'function') throw new TypeError('createDraggable2DState 需要位移回调')
    return createDragState(true, (xDp, yDp, modifiers) => onDelta(Object.freeze({ xDp, yDp }), modifiers))
}
