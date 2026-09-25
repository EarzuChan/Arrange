import { effectScope, watch } from '@arrange/framework'
import test from "node:test"
import assert from "node:assert/strict"
import { tween, linearEasing, animatedColorAsRef, animatedDpAsRef, animatedNumberAsRef, createTransition } from '../../packages/framework/src/animation/index.ts'
import { frameScope } from './frameScope.ts'
import { ref } from '../../packages/framework/src/index.ts'

test("animatedNumberAsRef follows target changes with a deterministic clock", () => {
    const clock = frameScope()
    const target = ref(0)
    const animated = clock.run(() => animatedNumberAsRef(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))

    target.value = 10
    clock.advanceBy(50)
    assert.equal(animated.value, 5)
    clock.advanceBy(50)
    assert.equal(animated.value, 10)

    animated.stop()
})

test("animatedDpAsRef uses the same numeric dp timeline", () => {
    const clock = frameScope()
    const target = ref(8)
    const animated = clock.run(() => animatedDpAsRef(target, { animationSpec: tween({ durationMillis: 80, easing: linearEasing }) }))

    target.value = 24
    clock.advanceBy(20)
    assert.equal(animated.value, 12)
    clock.advanceBy(60)
    assert.equal(animated.value, 24)

    animated.stop()
})

test("animatedColorAsRef interpolates ARGB channels", () => {
    const clock = frameScope()
    const target = ref(0xff000000)
    const animated = clock.run(() => animatedColorAsRef(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))

    target.value = 0xffffffff
    clock.advanceBy(50)
    assert.equal(animated.value, 0xff808080)
    clock.advanceBy(50)
    assert.equal(animated.value, 0xffffffff)

    animated.stop()
})

test("createTransition derives animated values from a reactive target state", () => {
    const clock = frameScope()
    const open = ref(false)
    const transition = clock.run(() => createTransition(open, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))
    const width = clock.run(() => transition.animatedDp("width", (state) => state ? 200 : 100))

    open.value = true
    clock.advanceBy(25)
    assert.equal(width.value, 125)
    clock.advanceBy(75)
    assert.equal(width.value, 200)

    width.stop()
})

test("infinite transition repeats values on the owner frame clock and stop releases the frame", async () => {
    const { createInfiniteTransition, animationStats } = await import('../../packages/framework/src/animation/index.ts')
    const baseline = animationStats.activeAnimations
    const clock = frameScope()
    const transition = clock.run(() => createInfiniteTransition({ label: 'HueTransition' }))
    const hue = clock.run(() => transition.animatedNumber('Hue', 0, 360, {
        animationSpec: tween({ durationMillis: 100, easing: linearEasing }),
    }))

    clock.advanceBy(50)
    assert.equal(hue.value, 180)
    clock.advanceBy(50)
    assert.equal(hue.value, 0)
    assert.equal(transition.isRunning.value, true)
    hue.stop()
    assert.equal(transition.isRunning.value, false)
    assert.equal(animationStats.activeAnimations, baseline)
    transition.stop()
})

test("infinite transition supports reverse repeat mode and rejects zero duration", async () => {
    const { createInfiniteTransition } = await import('../../packages/framework/src/animation/index.ts')
    const clock = frameScope()
    const transition = clock.run(() => createInfiniteTransition())
    const value = clock.run(() => transition.animatedNumber('reverse', 0, 10, {
        animationSpec: tween({ durationMillis: 100, easing: linearEasing }), repeatMode: 'reverse',
    }))
    clock.advanceBy(150)
    assert.equal(value.value, 5)
    value.stop()
    assert.throws(() => clock.run(() => transition.animatedNumber('invalid', 0, 1, {
        animationSpec: tween({ durationMillis: 0 }),
    })), /durationMillis 大于 0/)
    transition.stop()
})

test("all value groups animate on one clock and reject changing vector dimensions", async () => {
    const { animatedNumberArrayAsRef, animatedOffsetAsRef, animatedSizeAsRef, animatedRectAsRef } = await import('../../packages/framework/src/animation/index.ts')
    const clock = frameScope()
    const args = { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }
    const vector = ref<readonly number[]>([0, 10])
    const offset = ref({ x: 0, y: 10 })
    const size = ref({ width: 20, height: 30 })
    const rect = ref({ x: 0, y: 10, width: 20, height: 30 })
    const values = [clock.run(() => animatedNumberArrayAsRef(vector, args)), clock.run(() => animatedOffsetAsRef(offset, args)), clock.run(() => animatedSizeAsRef(size, args)), clock.run(() => animatedRectAsRef(rect, args))]
    vector.value = [10, 20]
    offset.value = { x: 10, y: 20 }
    size.value = { width: 30, height: 40 }
    rect.value = { x: 10, y: 20, width: 30, height: 40 }
    clock.advanceBy(50)
    assert.deepEqual(values.map(value => value.value), [[5, 15], { x: 5, y: 15 }, { width: 25, height: 35 }, { x: 5, y: 15, width: 25, height: 35 }])
    assert.throws(() => { vector.value = [1] }, /长度不能改变/)
    values.forEach(value => value.stop())
})

test("spring retarget preserves velocity and is independent of frame subdivision", async () => {
    const { spring } = await import('../../packages/framework/src/animation/index.ts')
    const aClock = frameScope(), bClock = frameScope()
    const aTarget = ref(0), bTarget = ref(0)
    const spec = spring({ stiffness: 100, dampingRatio: 0.6 })
    const a = aClock.run(() => animatedNumberAsRef(aTarget, { animationSpec: spec }))
    const b = bClock.run(() => animatedNumberAsRef(bTarget, { animationSpec: spec }))
    aTarget.value = bTarget.value = 100
    aClock.advanceBy(100)
    for (let i = 0; i < 10; i++) bClock.advanceBy(10)
    assert.ok(Math.abs(a.value - b.value) < 1e-9)
    const atTurn = a.value
    aTarget.value = 0
    assert.equal(a.value, atTurn)
    aClock.advanceBy(1)
    assert.ok(a.value > atTurn, 'spring lost forward momentum on reversal')
    aClock.advanceBy(10000)
    assert.equal(a.value, 0)
    assert.equal(a.isRunning.value, false)
    a.stop()
    b.stop()
})

test("Transition publishes coherent channels even to synchronous watchers and retires children", async () => {
    const { animationStats } = await import('../../packages/framework/src/animation/index.ts')
    const baseline = animationStats.activeAnimations
    const clock = frameScope(), target = ref(false)
    const transition = clock.run(() => createTransition(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))
    const x = clock.run(() => transition.animatedNumber('x', state => state ? 100 : 0))
    const y = clock.run(() => transition.animatedNumber('y', state => state ? 200 : 0))
    const observed: number[][] = []
    const stopWatch = watch(() => [x.value, y.value], value => observed.push(value), { flush: 'sync' })
    target.value = true
    assert.equal(transition.isRunning.value, true)
    clock.advanceBy(50)
    assert.deepEqual(observed, [[50, 100]])
    x.stop()
    clock.advanceBy(50)
    assert.equal(x.value, 50)
    assert.equal(y.value, 200)
    assert.equal(transition.currentState.value, true)
    assert.equal(transition.isRunning.value, false)
    stopWatch()
    transition.stop()
    assert.equal(animationStats.activeAnimations, baseline)
})

test("scope disposal cancels queued frames and target subscriptions; snap and delayed tween settle", async () => {
    const { snap, animationStats } = await import('../../packages/framework/src/animation/index.ts')
    const baseline = animationStats.activeAnimations
    const clock = frameScope(), target = ref(0)
    const scope = clock.run(() => effectScope())
    const animated = scope.run(() => animatedNumberAsRef(target, { animationSpec: tween({ durationMillis: 100, delayMillis: 20, easing: linearEasing }) }))!
    target.value = 100
    clock.advanceBy(10)
    assert.equal(animated.value, 0)
    clock.advanceBy(60)
    assert.equal(animated.value, 50)
    scope.stop()
    target.value = 200
    clock.advanceBy(500)
    assert.equal(animated.value, 50)
    const instant = clock.run(() => animatedNumberAsRef(target, { animationSpec: snap() }))
    target.value = 42
    clock.advanceBy(0)
    assert.equal(instant.value, 42)
    instant.stop()
    assert.equal(animationStats.activeAnimations, baseline)
})

test("completion callbacks observe the complete frame and stopping a sibling suppresses its queued callback", () => {
    const clock = frameScope()
    const observed: number[][] = []
    const spec = tween({ durationMillis: 100, easing: linearEasing })
    const xTarget = ref(0), yTarget = ref(0)
    const x = clock.run(() => animatedNumberAsRef(xTarget, {
        animationSpec: spec, finished() {
            observed.push([x.value, y.value])
            y.stop()
        }
    }))
    const y = clock.run(() => animatedNumberAsRef(yTarget, { animationSpec: spec, finished() { throw new Error('retired completion ran') } }))
    xTarget.value = 10
    yTarget.value = 20
    clock.advanceBy(100)
    assert.deepEqual(observed, [[10, 20]])
    x.stop()
})

test("group animation tracks reactive fields and bounds size overshoot", async () => {
    const { animatedOffsetAsRef, animatedSizeAsRef, spring } = await import('../../packages/framework/src/animation/index.ts')
    const clock = frameScope(), point = ref({ x: 0, y: 0 }), size = ref({ width: 50, height: 50 })
    const offset = clock.run(() => animatedOffsetAsRef(point, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))
    const dimensions = clock.run(() => animatedSizeAsRef(size, { animationSpec: spring({ stiffness: 100, dampingRatio: 0.1 }) }))
    point.value.x = 20
    size.value.width = 0
    assert.equal(offset.value.x, 0, 'animated value aliased the mutable target')
    assert.equal(dimensions.value.width, 50, 'size snapshot changed before its animation sample')
    clock.advanceBy(50)
    assert.equal(offset.value.x, 10)
    clock.advanceBy(300)
    assert.ok(dimensions.value.width >= 0)
    offset.stop()
    dimensions.stop()
})

test("Transition child mappings follow their actual reactive reads and stop unsubscribes them", () => {
    const clock = frameScope(), target = ref(false), extent = ref(100)
    const transition = clock.run(() => createTransition(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))
    const width = clock.run(() => transition.animatedDp('width', state => state ? extent.value : 0))
    target.value = true
    clock.advanceBy(100)
    assert.equal(width.value, 100)
    extent.value = 200
    clock.advanceBy(50)
    assert.equal(width.value, 150)
    transition.stop()
    extent.value = 300
    clock.advanceBy(100)
    assert.equal(width.value, 150)
})
