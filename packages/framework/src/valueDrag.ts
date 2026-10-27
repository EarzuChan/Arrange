import { reactive, type Ref } from '@arrange/reactivity'
import { createDraggableState, createDraggable2DState, type DragModifiers, type DragStart, type DraggableState, type Draggable2DState, type InteractionState } from './gesture.ts'
import { M, type KeyEvent, type Modifier, type WheelEvent } from './modifier.ts'
import { findFrameScheduler } from './runtime/animationOwner.ts'
import type { FrameParticipant, FrameScheduler } from './runtime/scheduler.ts'

// 可编辑值：value 为响应式读取，begin / end 标出一次连续编辑；默认值与步长（按全程比例）可由提供方给出
export interface EditableValue {
    readonly value: number
    readonly defaultValue?: number
    readonly step?: number
    begin?(): void
    set(value: number): void
    end?(): void
}

export function editableRef(ref: Ref<number>): EditableValue {
    return Object.freeze({
        get value() { return ref.value },
        set: (value: number) => { ref.value = value },
    })
}

export type ValueDragMapping = 'vertical' | 'horizontal' | 'both' | 'angle'
export type ValueDragOptions = {
    value: EditableValue
    range?: Readonly<{ min: number; max: number }>
    step?: number
    defaultValue?: number
    fullRangeDp?: number
    fine?: Readonly<{ factor: number; modifier: 'shift' | 'alt' | 'ctrl' | 'meta' }>
    mapping?: ValueDragMapping
    angleSweepDeg?: number
    wheel?: false | Readonly<{ fraction: number }>
    keyboard?: Readonly<{ small: number; large: number }>
}

type Config = Required<Omit<ValueDragOptions, 'step' | 'defaultValue'>> & Pick<ValueDragOptions, 'step' | 'defaultValue'>

export interface ValueDragState {
    editable: EditableValue
    range: Readonly<{ min: number; max: number }>
    step: number | undefined
    defaultValue: number | undefined
    fullRangeDp: number
    fine: Readonly<{ factor: number; modifier: 'shift' | 'alt' | 'ctrl' | 'meta' }>
    mapping: ValueDragMapping
    angleSweepDeg: number
    wheel: false | Readonly<{ fraction: number }>
    keyboard: Readonly<{ small: number; large: number }>
    readonly value: number
    readonly fraction: number
    readonly isDragging: boolean
    readonly isEditing: boolean
    reset(): void
    stepBy(steps: number): void
    setFraction(fraction: number): void
}

interface ValueDragInternal {
    readonly drag: DraggableState
    readonly drag2D: Draggable2DState
    started(start: DragStart): void
    stopped(): void
    wheel(event: WheelEvent): void
    key(event: KeyEvent): boolean
}

const internals = new WeakMap<object, ValueDragInternal>()
const WHEEL_GROUP_MILLIS = 300

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

function positive(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} 必须是正有限数值`)
    return value
}

function validate(config: Partial<Config>): void {
    if (config.value !== undefined && (typeof config.value !== 'object' || typeof config.value?.set !== 'function')) throw new TypeError('createValueDragState 需要可编辑值（editableRef() 或 param.editable()）')
    if (config.range && !(Number.isFinite(config.range.min) && Number.isFinite(config.range.max) && config.range.max > config.range.min)) throw new RangeError('range 需要有限且 max > min')
    if (config.step !== undefined) positive(config.step, 'step')
    if (config.fullRangeDp !== undefined) positive(config.fullRangeDp, 'fullRangeDp')
    if (config.angleSweepDeg !== undefined) positive(config.angleSweepDeg, 'angleSweepDeg')
    if (config.fine) positive(config.fine.factor, 'fine.factor')
    if (config.wheel) positive(config.wheel.fraction, 'wheel.fraction')
    if (config.keyboard) (positive(config.keyboard.small, 'keyboard.small'), positive(config.keyboard.large, 'keyboard.large'))
    if (config.mapping !== undefined && !['vertical', 'horizontal', 'both', 'angle'].includes(config.mapping)) throw new TypeError("mapping 只能是 'vertical'、'horizontal'、'both' 或 'angle'")
}

// 数值拖动状态不持有数值，只把位移、滚轮与按键换算为对可编辑值的写入
export function createValueDragState(options: ValueDragOptions): ValueDragState {
    validate(options)
    const config = reactive<Config>({ range: { min: 0, max: 1 }, fullRangeDp: 200, fine: { factor: 0.1, modifier: 'shift' }, mapping: 'vertical', angleSweepDeg: 270, wheel: false, keyboard: { small: 0.01, large: 0.1 }, ...options })
    const flags = reactive({ isDragging: false, isEditing: false })
    const scheduler: FrameScheduler | undefined = findFrameScheduler()

    const editable = () => config.value
    const min = () => config.range.min
    const span = () => config.range.max - config.range.min
    const fraction = () => clampUnit((editable().value - min()) / span())
    const step = () => config.step ?? editable().step
    const defaultValue = () => config.defaultValue ?? editable().defaultValue

    const beginEdit = () => {
        if (flags.isEditing) return
        flags.isEditing = true
        editable().begin?.()
    }
    const endEdit = () => {
        if (!flags.isEditing) return
        flags.isEditing = false
        editable().end?.()
    }
    // 写入时才吸附步长；结果与当前值相同则不写，首次真实写值才开始编辑
    const writeFraction = (target: number) => {
        const unit = step()
        const snapped = clampUnit(unit ? Math.round(clampUnit(target) / unit) * unit : target)
        const next = min() + snapped * span()
        if (next === editable().value) return
        beginEdit()
        editable().set(next)
    }
    // 离散编辑各自是一次完整的 begin / set / end
    const complete = (write: () => void) => {
        endWheel()
        write()
        if (!flags.isDragging) endEdit()
    }

    let wheelTarget: number | undefined
    let lastWheel = 0
    const wheelGroup: FrameParticipant = {
        sample: time => { if (time - lastWheel >= WHEEL_GROUP_MILLIS) endWheel() },
        active: () => wheelTarget !== undefined,
    }
    function endWheel() {
        if (wheelTarget === undefined) return
        wheelTarget = undefined
        scheduler?.remove(wheelGroup)
        if (!flags.isDragging) endEdit()
    }

    let accumulated = 0
    let pointer = { x: 0, y: 0 }
    let center = { x: 0, y: 0 }
    let lastAngle = 0
    const angleOf = (x: number, y: number) => Math.atan2(x - center.x, center.y - y) * 180 / Math.PI
    const fineFactor = (modifiers: DragModifiers) => modifiers[config.fine.modifier] ? config.fine.factor : 1
    // 精调倍率只作用于其生效那段位移；累加不量化，避免步进参数的小位移被吸附吞掉
    const accumulate = (deltaFraction: number, modifiers: DragModifiers) => {
        accumulated = clampUnit(accumulated + deltaFraction * fineFactor(modifiers))
        writeFraction(accumulated)
    }

    const internal: ValueDragInternal = {
        drag: createDraggableState((deltaDp, modifiers) => accumulate((config.mapping === 'horizontal' ? deltaDp : -deltaDp) / config.fullRangeDp, modifiers)),
        drag2D: createDraggable2DState(({ xDp, yDp }, modifiers) => {
            if (config.mapping !== 'angle') return accumulate((xDp - yDp) / config.fullRangeDp, modifiers)
            pointer = { x: pointer.x + xDp, y: pointer.y + yDp }
            const angle = angleOf(pointer.x, pointer.y)
            // 跨越 ±180° 时连续展开
            const delta = ((angle - lastAngle + 540) % 360) - 180
            lastAngle = angle
            accumulate(delta / config.angleSweepDeg, modifiers)
        }),
        started: start => {
            endWheel()
            flags.isDragging = true
            accumulated = fraction()
            pointer = { x: start.xDp, y: start.yDp }
            center = { x: start.widthDp / 2, y: start.heightDp / 2 }
            lastAngle = angleOf(pointer.x, pointer.y)
        },
        stopped: () => {
            flags.isDragging = false
            endEdit()
        },
        wheel: event => {
            if (!config.wheel || flags.isDragging) return
            // 正值为向上 / 向左滚动：向上增加，向左减少
            const amount = (event.deltaYDp - event.deltaXDp) / 16 * config.wheel.fraction * fineFactor(event.modifiers)
            if (wheelTarget === undefined) {
                wheelTarget = fraction()
                scheduler?.add(wheelGroup)
            }
            lastWheel = scheduler?.now() ?? 0
            wheelTarget = clampUnit(wheelTarget + amount)
            writeFraction(wheelTarget)
        },
        key: event => {
            if (event.type !== 'down') return false
            const keys: Record<string, () => void> = {
                ArrowUp: () => state.stepBy(1),
                ArrowRight: () => state.stepBy(1),
                ArrowDown: () => state.stepBy(-1),
                ArrowLeft: () => state.stepBy(-1),
                PageUp: () => complete(() => writeFraction(fraction() + config.keyboard.large)),
                PageDown: () => complete(() => writeFraction(fraction() - config.keyboard.large)),
                Home: () => state.setFraction(0),
                End: () => state.setFraction(1),
            }
            const action = keys[event.key]
            if (!action) return false
            action()
            return true
        },
    }

    const state: ValueDragState = Object.freeze({
        get editable() { return config.value },
        set editable(value: EditableValue) { (validate({ value }), config.value = value) },
        get range() { return config.range },
        set range(value) { (validate({ range: value }), config.range = value) },
        get step() { return config.step },
        set step(value) { (validate({ step: value }), config.step = value) },
        get defaultValue() { return config.defaultValue },
        set defaultValue(value) { config.defaultValue = value },
        get fullRangeDp() { return config.fullRangeDp },
        set fullRangeDp(value) { (validate({ fullRangeDp: value }), config.fullRangeDp = value) },
        get fine() { return config.fine },
        set fine(value) { (validate({ fine: value }), config.fine = value) },
        get mapping() { return config.mapping },
        set mapping(value) { (validate({ mapping: value }), config.mapping = value) },
        get angleSweepDeg() { return config.angleSweepDeg },
        set angleSweepDeg(value) { (validate({ angleSweepDeg: value }), config.angleSweepDeg = value) },
        get wheel() { return config.wheel },
        set wheel(value) { (validate({ wheel: value }), config.wheel = value) },
        get keyboard() { return config.keyboard },
        set keyboard(value) { (validate({ keyboard: value }), config.keyboard = value) },
        get value() { return editable().value },
        get fraction() { return fraction() },
        get isDragging() { return flags.isDragging },
        get isEditing() { return flags.isEditing },
        reset() {
            const target = defaultValue()
            if (target === undefined) return
            complete(() => {
                if (target === editable().value) return
                beginEdit()
                editable().set(target)
            })
        },
        stepBy(steps: number) {
            if (!Number.isFinite(steps)) throw new RangeError('stepBy 需要有限数值')
            // 步进参数至少移动一个步长
            const unit = step()
            const delta = steps * config.keyboard.small
            complete(() => writeFraction(fraction() + (unit && Math.abs(delta) < unit ? Math.sign(delta) * unit : delta)))
        },
        setFraction(value: number) {
            if (!Number.isFinite(value)) throw new RangeError('setFraction 需要有限数值')
            complete(() => writeFraction(value))
        },
    })
    internals.set(state, internal)
    return state
}

function valueDragInternal(state: ValueDragState): ValueDragInternal {
    const internal = internals.get(state)
    if (!internal) throw new TypeError('adjustable 需要 createValueDragState() 创建的状态')
    return internal
}

export type AdjustableOptions = { pointerLock?: boolean; startImmediately?: boolean; valueText?: string; enabled?: boolean; interactionState?: InteractionState }

// 只组合公开原语：拖动、双击复位、焦点与按键、滚轮和语义
export function adjustable(state: ValueDragState, args: AdjustableOptions = {}): Modifier {
    const internal = valueDragInternal(state)
    const enabled = args.enabled ?? true
    const { interactionState } = args
    const drag = { enabled, pointerLock: args.pointerLock, startImmediately: args.startImmediately, interactionState, onDragStarted: internal.started, onDragStopped: internal.stopped }
    let modifier = state.mapping === 'both' || state.mapping === 'angle' ? M.draggable2D(internal.drag2D, drag) : M.draggable(internal.drag, { ...drag, orientation: state.mapping === 'horizontal' ? 'horizontal' : 'vertical' })
    if (state.defaultValue !== undefined || state.editable.defaultValue !== undefined) modifier = modifier.clickable({ onClick: () => { }, onDoubleClick: () => state.reset(), enabled, focusable: false })
    modifier = modifier.focusable({ enabled, interactionState }).onKeyEvent(event => enabled && internal.key(event))
    if (state.wheel) modifier = modifier.onWheel(internal.wheel, { enabled })
    return modifier.semantics({ role: 'slider', valueText: args.valueText, enabled, increment: () => state.stepBy(1), decrement: () => state.stepBy(-1) })
}
