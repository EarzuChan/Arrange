import test from "node:test"
import assert from "node:assert/strict"
import { createScrollState, watch } from '../../packages/framework/src/index.ts'
import { scrollStateInternal } from '../../packages/framework/src/state.ts'
import { M } from '@arrange/framework/ui'

test('布局输出的范围变化不重新求值滚动 Modifier，偏移变化仍正常订阅', () => {
    const state = createScrollState()
    let evaluations = 0
    const stop = watch(() => M.verticalScroll(state), () => { evaluations++ }, { flush: 'sync' })

    scrollStateInternal(state).native({ value: 0, maxValue: 200, viewportSize: 100, contentSize: 300 })
    assert.equal(evaluations, 0)
    state.scrollTo(30)
    assert.equal(evaluations, 1)
    stop()
})

test('滚动布局快照整组发布，同步观察者只读取完整的新状态', () => {
    const state = createScrollState()
    const observed: number[][] = []
    const stop = watch(() => [state.valuePx, state.maxValuePx, state.viewportSizePx, state.contentSizePx, Number(state.canScrollForward), Number(state.canScrollBackward)], value => observed.push(value), { flush: 'sync' })

    scrollStateInternal(state).native({ value: 20, maxValue: 20, viewportSize: 80, contentSize: 100 })
    scrollStateInternal(state).native({ value: 0, maxValue: 0, viewportSize: 120, contentSize: 100 })
    assert.deepEqual(observed, [[20, 20, 80, 100, 0, 1], [0, 0, 120, 100, 0, 0]])
    stop()
})

test("ScrollState 镜像原生类型化滚动快照", () => {
    const state = createScrollState({ initialPx: 4 })
    assert.equal(state.valuePx, 4)
    assert.equal(state.canScrollBackward, true)
    assert.equal(state.canScrollForward, false)

    scrollStateInternal(state).native({ value: 12, maxValue: 40, viewportSize: 80, contentSize: 120, isScrollInProgress: true })
    assert.equal(state.valuePx, 12)
    assert.equal(state.maxValuePx, 40)
    assert.equal(state.viewportSizePx, 80)
    assert.equal(state.contentSizePx, 120)
    assert.equal(state.canScrollBackward, true)
    assert.equal(state.canScrollForward, true)
    assert.equal(state.isScrollInProgress, true)

    state.scrollTo(40)
    assert.equal(state.valuePx, 40)
    assert.equal(state.canScrollForward, false)
})

test("ScrollState 原生回调不依赖 this 绑定", () => {
    const state = createScrollState({ initialPx: 0 })
    const callback = scrollStateInternal(state).native

    callback({ value: 7, maxValue: 12, viewportSize: 4, contentSize: 16 })

    assert.equal(state.valuePx, 7)
    assert.equal(state.maxValuePx, 12)
    assert.equal(state.viewportSizePx, 4)
    assert.equal(state.contentSizePx, 16)
    assert.equal(state.canScrollBackward, true)
    assert.equal(state.canScrollForward, true)
})

test('ScrollState 公开形态只读且不暴露内部通道', () => {
    const state = createScrollState()
    assert.ok(Object.isFrozen(state))
    assert.equal(Object.keys(state).some(key => key.startsWith('__')), false)
    assert.throws(() => { (state as { valuePx: number }).valuePx = 3 }, TypeError)
})
