import test from "node:test"
import assert from "node:assert/strict"
import { M, createDensity } from '@arrange/framework/ui'
import type { ContextClickEvent } from '@arrange/framework/ui'
import { UnitResolver } from '../../packages/framework/src/resolveUnits.ts'
import { createDraggableState, createDraggable2DState, createInteractionState } from '../../packages/framework/src/index.ts'

const fire = (callback: unknown, event: unknown) => (callback as (event: unknown) => void)(event)

test('onContextClick 把原生 PX 坐标换算为 dp，且包装回调在重排间保持同一身份', () => {
    const units = new UnitResolver(createDensity(2))
    const events: ContextClickEvent[] = []
    const callback = (event: ContextClickEvent) => { events.push(event) }
    const first = units.modifier(M.onContextClick(callback).pointerIcon('hand'))
    const second = units.modifier(M.onContextClick(callback).pointerIcon('hand'))
    const native = first.elements[0].value.callback as (event: unknown) => void
    assert.equal(second.elements[0].value.callback, native)
    native({ x: 20, y: 10, modifiers: { shift: true, alt: false, ctrl: false, meta: false, command: false } })
    assert.deepEqual(events, [{ xDp: 10, yDp: 5, modifiers: { shift: true, alt: false, ctrl: false, meta: false, command: false } }])
    assert.deepEqual(first.elements[1].value, { icon: 'hand' })
})

test('hoverable 与 clickable 的可选回调只在提供时进入描述', () => {
    const onEnter = () => { }
    const onDoubleClick = () => { }
    const modifier = M.hoverable({ onEnter }).clickable({ onClick: () => { }, onDoubleClick })
    assert.deepEqual(Object.keys(modifier.elements[0].value).sort(), ['enabled', 'onEnter'])
    assert.equal(modifier.elements[1].value.onDoubleClick, onDoubleClick)
})

test('draggable 把原生 PX 位移换算为所选轴的 dp，并维护 isDragging', () => {
    const units = new UnitResolver(createDensity(2))
    const deltas: number[] = []
    const starts: unknown[] = []
    const stops: unknown[] = []
    const state = createDraggableState(delta => { deltas.push(delta) })
    const declare = () => units.modifier(M.draggable(state, { orientation: 'horizontal', pointerLock: true, onDragStarted: start => { starts.push(start) }, onDragStopped: stop => { stops.push(stop) } }))
    const first = declare().elements[0].value
    const second = declare().elements[0].value
    assert.equal(second.onDelta, first.onDelta)
    assert.deepEqual({ enabled: first.enabled, axis: first.axis, startImmediately: first.startImmediately, pointerLock: first.pointerLock }, { enabled: true, axis: 'horizontal', startImmediately: false, pointerLock: true })
    const modifiers = { shift: false, alt: false, ctrl: false, meta: false, command: false }
    fire(first.onStart, { x: 4, y: 6, width: 100, height: 40, modifiers })
    assert.equal(state.isDragging, true)
    fire(first.onDelta, { deltaX: 10, deltaY: 30, modifiers })
    fire(first.onStop, { velocity: 200, cancelled: false })
    assert.equal(state.isDragging, false)
    assert.deepEqual(deltas, [5])
    assert.deepEqual(starts, [{ xDp: 2, yDp: 3, widthDp: 50, heightDp: 20, modifiers }])
    assert.deepEqual(stops, [{ velocityDp: 100, cancelled: false }])
})

test('draggable2D 交付二维 dp 位移，单轴与二维状态不能混用', () => {
    const units = new UnitResolver(createDensity(2))
    const deltas: unknown[] = []
    const state = createDraggable2DState(delta => { deltas.push(delta) })
    const native = units.modifier(M.draggable2D(state)).elements[0].value
    assert.equal(native.axis, 'both')
    fire(native.onDelta, { deltaX: 2, deltaY: -4, modifiers: {} })
    assert.deepEqual(deltas, [{ xDp: 1, yDp: -2 }])
    assert.throws(() => M.draggable(state as never), TypeError)
    assert.throws(() => M.draggable2D(createDraggableState(() => { })), TypeError)
})

test('interactionState 接入原生 interaction 槽，可聚焦原语附带焦点观察', () => {
    const interaction = createInteractionState()
    const modifier = M.clickable({ onClick: () => { }, interactionState: interaction }).hoverable({ interactionState: interaction })
    assert.deepEqual(modifier.elements.map(element => element.type), ['clickable', 'onFocusChanged', 'hoverable'])
    assert.equal('interactionState' in modifier.elements[0].value, false)
    assert.equal(modifier.elements[0].value.interaction, modifier.elements[2].value.interaction)
    fire(modifier.elements[0].value.interaction, { hovered: true, pressed: true, focused: false, dragged: false })
    fire(modifier.elements[1].value.callback, { isFocused: true, hasFocus: true })
    assert.deepEqual({ ...interaction }, { hovered: true, pressed: true, focused: true, dragged: false })
    assert.throws(() => M.hoverable({ interactionState: {} as never }), TypeError)
})

test('semantics 原样声明角色、文本与增减动作', () => {
    const increment = () => { }
    const [element] = M.semantics({ role: 'slider', label: '增益', valueText: '-6 dB', increment }).elements
    assert.equal(element.type, 'semantics')
    assert.deepEqual(element.value, { role: 'slider', label: '增益', valueText: '-6 dB', increment })
})
