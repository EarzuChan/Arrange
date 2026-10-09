import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from '@arrange/framework'
import { FlowRow, FlowColumn } from '@arrange/framework/foundation'
import { M, IntrinsicSize, FlowRowMeasurePolicy, FlowColumnMeasurePolicy, Arrangement, createDensity } from '@arrange/framework/ui'
import { repeatable, tween, snap, spring, linearEasing, animatedNumberAsRef, nativeAnimationSpec, createTransition } from '../../packages/framework/src/animation/value.ts'
import { UnitResolver } from '../../packages/framework/src/resolveUnits.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { frameScope } from './frameScope.ts'

test('固有尺寸在 TS 和 SFA 使用正式 overload，长度与 Flow 间距仍经过 Density', () => {
    assert.deepEqual(M.width(IntrinsicSize.Min).height(IntrinsicSize.Max).elements.map(value => [value.type, value.value]), [['intrinsicWidth', { maximum: false }], ['intrinsicHeight', { maximum: true }]])
    const source = '<template><FlowRow :modifier="M.width(IntrinsicSize.Min)" :horizontalArrangement="Arrangement.spacedBy(4.dp + 2.px)"/></template><script>import { FlowRow } from "@arrange/framework/foundation"\nimport { M, IntrinsicSize, Arrangement } from "@arrange/framework/ui"</script>'
    const compiled = compileArrangeSfa(source, '固有尺寸.sfa')
    assert.match(compiled.code, /_unref\(IntrinsicSize\)\.Min/)
    assert.match(compiled.code, /spacedBy\(4, 2\)/)
    const units = new UnitResolver(createDensity(2))
    assert.deepEqual(units.modifier(M.width(IntrinsicSize.Min)).elements[0].value, { maximum: false })
    const policy = units.measurePolicy(FlowRowMeasurePolicy({ horizontalArrangement: Arrangement.spacedBy(4, 2), verticalArrangement: Arrangement.spacedBy(3, 1) }))
    assert.deepEqual(policy, { kind: 'FlowRow', horizontalArrangement: { kind: 'spacedBy', space: 10 }, verticalArrangement: { kind: 'spacedBy', space: 7 } })
    assert.deepEqual(units.measurePolicy(FlowRowMeasurePolicy({ horizontalArrangement: Arrangement.spacedBy(4, 2), maxItemsInEachRow: 2 })), { kind: 'FlowRow', horizontalArrangement: { kind: 'spacedBy', space: 10 }, maxItemsInEachRow: 2 })
    assert.equal(FlowRow.name, 'FlowRow')
    assert.equal(FlowColumn.name, 'FlowColumn')
    assert.throws(() => FlowColumnMeasurePolicy({ maxItemsInEachColumn: 0 }), /正整数/)
})

test('有限重复按绝对时间跨周期采样，Reverse 偶数次数完成时抵达逻辑目标且只通知一次', () => {
    const clock = frameScope()
    const target = ref(0)
    let completed = 0
    const animation = clock.run(() => animatedNumberAsRef(target, { animationSpec: repeatable({ iterations: 2, animation: tween({ durationMillis: 100, delayMillis: 20, easing: linearEasing }), repeatMode: 'reverse' }), finished: () => completed++ }))
    target.value = 10
    clock.advanceBy(70)
    assert.equal(animation.value, 5)
    clock.advanceBy(60)
    assert.equal(animation.value, 10)
    clock.advanceBy(60)
    assert.equal(animation.value, 5)
    clock.advanceBy(1000)
    assert.equal(animation.value, 10)
    assert.equal(animation.isRunning.value, false)
    assert.equal(completed, 1)
    clock.advanceBy(100)
    assert.equal(completed, 1)
    animation.stop()
})

test('Restart 跳帧结束、重定向和 Transition 共用有限重复规格', () => {
    const clock = frameScope()
    const target = ref(false)
    const spec = repeatable({ iterations: 3, animation: tween({ durationMillis: 100, easing: linearEasing }) })
    const transition = clock.run(() => createTransition(target, { animationSpec: spec }))
    const value = clock.run(() => transition.animatedNumber('值', active => active ? 10 : 0))
    target.value = true
    clock.advanceBy(250)
    assert.equal(value.value, 5)
    target.value = false
    clock.advanceBy(150)
    assert.equal(value.value, 2.5)
    clock.advanceBy(1000)
    assert.equal(value.value, 0)
    value.stop()
    assert.deepEqual(nativeAnimationSpec(repeatable({ iterations: 2, animation: snap(10), repeatMode: 'reverse' })), { kind: 'snap', delayMillis: 10, iterations: 2, repeatMode: 'reverse' })
    assert.throws(() => repeatable({ iterations: 0, animation: snap() }), /重复次数/)
    assert.throws(() => repeatable({ iterations: 2, animation: spring() as never }), /tween 或 snap/)
    assert.throws(() => repeatable({ iterations: 2, animation: snap(), repeatMode: 'invalid' as never }), /重复模式/)
    assert.throws(() => repeatable({ iterations: 2, animation: tween({ durationMillis: Number.MAX_VALUE }) }), /总时长/)
})
