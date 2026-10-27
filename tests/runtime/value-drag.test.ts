import test from 'node:test'
import assert from 'node:assert/strict'
import { adjustable, createValueDragState, editableRef, ref, type EditableValue } from '../../packages/framework/src/index.ts'
import { dragStateInternal } from '../../packages/framework/src/gesture.ts'
import { frameScope } from './frameScope.ts'

const none = { shift: false, alt: false, ctrl: false, meta: false, command: false }
const shift = { ...none, shift: true }

// 记录 begin / set / end 序列的可编辑值
function recorder(initial: number, extra: Partial<EditableValue> = {}) {
    const value = ref(initial)
    const calls: string[] = []
    const editable: EditableValue = {
        get value() { return value.value },
        begin: () => { calls.push('begin') },
        set: next => {
            calls.push(`set ${+next.toFixed(4)}`)
            value.value = next
        },
        end: () => { calls.push('end') },
        ...extra,
    }
    return { editable, calls, value }
}

// 从 adjustable 组合中取出拖动元素，直接驱动开始、位移与停止
function driver(modifier: ReturnType<typeof adjustable>) {
    const element = modifier.elements.find(item => item.type === 'draggable')!.value as Record<string, any>
    const internal = dragStateInternal(element.state)
    return {
        start: (xDp = 0, yDp = 0, widthDp = 100, heightDp = 100) => element.onDragStarted({ xDp, yDp, widthDp, heightDp, modifiers: none }),
        // 单轴状态由解析层把所选轴分量放在第一个参数
        delta: (xDp: number, yDp: number, modifiers = none) => internal.twoDimensional ? internal.delta(xDp, yDp, modifiers) : internal.delta(element.orientation === 'vertical' ? yDp : xDp, 0, modifiers),
        stop: (cancelled = false) => element.onDragStopped({ velocityDp: 0, cancelled }),
    }
}

const key = (modifier: ReturnType<typeof adjustable>, name: string, type: 'down' | 'up' = 'down') =>
    (modifier.elements.find(item => item.type === 'onKeyEvent')!.value.callback as (event: unknown) => boolean)({ type, key: name, text: '', repeat: false, modifiers: none })

test('纵向拖动向上增加，首次真实写值才 begin，停止与取消都 end，无变化拖动不产生编辑', () => {
    const { editable, calls } = recorder(0.5)
    const knob = createValueDragState({ value: editable })
    const drag = driver(adjustable(knob))
    drag.start()
    assert.equal(knob.isDragging, true)
    assert.deepEqual(calls, [])
    drag.delta(0, -20)
    drag.delta(0, -20, shift)
    drag.stop()
    assert.deepEqual(calls, ['begin', 'set 0.6', 'set 0.61', 'end'])
    assert.equal(knob.isDragging, false)
    calls.length = 0
    drag.start()
    drag.stop(true)
    assert.deepEqual(calls, [])
    drag.start()
    drag.delta(0, 40)
    drag.stop(true)
    assert.deepEqual(calls, ['begin', 'set 0.41', 'end'])
})

test('步进吸附只发生在写入时，小位移累加后仍能越过步长；夹到量程两端', () => {
    const { editable, calls } = recorder(0)
    const knob = createValueDragState({ value: editable, step: 0.25, mapping: 'horizontal' })
    const drag = driver(adjustable(knob))
    drag.start()
    for (let i = 0; i < 6; i++) drag.delta(5, 0)
    assert.deepEqual(calls, ['begin', 'set 0.25'])
    drag.delta(1000, 0)
    drag.delta(-10, 0)
    drag.stop()
    assert.deepEqual(calls, ['begin', 'set 0.25', 'set 1', 'end'])
})

test('angle 拖法按绕中心的角度变化计算并跨越 ±180° 连续展开', () => {
    const { editable } = recorder(0.5)
    const knob = createValueDragState({ value: editable, mapping: 'angle', angleSweepDeg: 360 })
    const modifier = adjustable(knob)
    assert.equal(modifier.elements[0].value.orientation, 'both')
    const drag = driver(modifier)
    drag.start(50, 0)
    drag.delta(50, 50)
    assert.equal(+knob.value.toFixed(4), 0.75)
    drag.delta(-50, 50)
    drag.delta(-50, -50)
    assert.equal(+knob.value.toFixed(4), 1)
    drag.stop()
})

test('editableRef 按 range 换算比例；键盘步进、Home / End 与复位各是一次完整编辑', () => {
    const value = ref(-60)
    const knob = createValueDragState({ value: editableRef(value), range: { min: -60, max: 0 }, defaultValue: -12 })
    const modifier = adjustable(knob)
    assert.deepEqual(modifier.elements.map(item => item.type), ['draggable', 'clickable', 'focusable', 'onKeyEvent', 'semantics'])
    assert.equal(key(modifier, 'ArrowUp'), true)
    assert.equal(+value.value.toFixed(4), -59.4)
    assert.equal(key(modifier, 'ArrowUp', 'up'), false)
    assert.equal(key(modifier, 'a'), false)
    key(modifier, 'End')
    assert.equal(value.value, 0)
    key(modifier, 'PageDown')
    assert.equal(+value.value.toFixed(4), -6)
    const reset = modifier.elements.find(item => item.type === 'clickable')!.value.onDoubleClick as () => void
    const decrement = modifier.elements.find(item => item.type === 'semantics')!.value.decrement as () => void
    reset()
    assert.equal(value.value, -12)
    decrement()
    assert.equal(+knob.value.toFixed(4), -12.6)
    assert.equal(knob.isEditing, false)
})

test('步进参数的键盘步进至少移动一个步长；无默认值时不加双击复位', () => {
    const { editable, calls } = recorder(0, { step: 0.5 })
    const knob = createValueDragState({ value: editable })
    const modifier = adjustable(knob)
    assert.equal(modifier.elements.some(item => item.type === 'clickable'), false)
    knob.stepBy(1)
    knob.reset()
    assert.deepEqual(calls, ['begin', 'set 0.5', 'end'])
})

test('滚轮连续滚动以 300ms 静默为界合并为一次编辑，拖动开始提前结束它', () => {
    const frames = frameScope()
    const { editable, calls } = recorder(0.5)
    const knob = frames.run(() => createValueDragState({ value: editable, wheel: { fraction: 0.1 } }))
    const modifier = adjustable(knob)
    const wheel = modifier.elements.find(item => item.type === 'onWheel')!.value.callback as (event: unknown) => void
    wheel({ deltaXDp: 0, deltaYDp: 16, modifiers: none })
    frames.advanceBy(100)
    wheel({ deltaXDp: 0, deltaYDp: 16, modifiers: none })
    frames.advanceBy(200)
    assert.deepEqual(calls, ['begin', 'set 0.6', 'set 0.7'])
    frames.advanceBy(300)
    assert.deepEqual(calls, ['begin', 'set 0.6', 'set 0.7', 'end'])
    calls.length = 0
    wheel({ deltaXDp: 0, deltaYDp: -16, modifiers: none })
    const drag = driver(modifier)
    drag.start()
    assert.deepEqual(calls, ['begin', 'set 0.6', 'end'])
    drag.stop()
    frames.stop()
})

test('adjustable 只组合公开原语并校验状态来源', () => {
    const knob = createValueDragState({ value: editableRef(ref(0)) })
    const semantics = adjustable(knob, { valueText: '0 dB' }).elements.at(-1)!
    assert.equal(semantics.type, 'semantics')
    assert.equal(semantics.value.role, 'slider')
    assert.equal(semantics.value.valueText, '0 dB')
    assert.throws(() => adjustable({} as never), TypeError)
    assert.throws(() => createValueDragState({ value: editableRef(ref(0)), fullRangeDp: 0 }), RangeError)
})

test('adjustable 重复调用时交给原语的回调身份不变，禁用后按键不再处理', () => {
    const knob = createValueDragState({ value: editableRef(ref(0)), defaultValue: 0 })
    const callbacks = (modifier: ReturnType<typeof adjustable>) => modifier.elements.flatMap(item => Object.values(item.value).filter(value => typeof value === 'function'))
    const first = adjustable(knob)
    assert.deepEqual(callbacks(adjustable(knob, { valueText: '变化' })), callbacks(first))
    const disabled = adjustable(knob, { enabled: false })
    assert.equal(key(disabled, 'ArrowUp'), false)
    assert.equal(knob.value, 0)
})
