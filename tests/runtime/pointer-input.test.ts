import test from "node:test"
import assert from "node:assert/strict"
import { M, createDensity } from '@arrange/framework/ui'
import type { ContextClickEvent } from '@arrange/framework/ui'
import { UnitResolver } from '../../packages/framework/src/resolveUnits.ts'

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
