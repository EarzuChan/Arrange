import { effectScope, watch } from '@arrange/framework'
import test from "node:test"
import assert from "node:assert/strict"
import { tween, linearEasing, animatedColorAsRef, animatedDpAsRef, animatedNumberAsRef, createManualAnimationClock, createTransition } from '../../packages/framework/src/animation/index.ts'
import { ref } from '../../packages/framework/src/index.ts'

test("animatedNumberAsRef follows target changes with a deterministic clock", () => {
    const clock = createManualAnimationClock()
    const target = ref(0)
    const animated = animatedNumberAsRef(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }), clock })

    target.value = 10
    clock.advanceBy(50)
    assert.equal(animated.value, 5)
    clock.advanceBy(50)
    assert.equal(animated.value, 10)

    animated.stop()
})

test("animatedDpAsRef uses the same numeric dp timeline", () => {
    const clock = createManualAnimationClock()
    const target = ref(8)
    const animated = animatedDpAsRef(target, { animationSpec: tween({ durationMillis: 80, easing: linearEasing }), clock })

    target.value = 24
    clock.advanceBy(20)
    assert.equal(animated.value, 12)
    clock.advanceBy(60)
    assert.equal(animated.value, 24)

    animated.stop()
})

test("animatedColorAsRef interpolates ARGB channels", () => {
    const clock = createManualAnimationClock()
    const target = ref(0xff000000)
    const animated = animatedColorAsRef(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }), clock })

    target.value = 0xffffffff
    clock.advanceBy(50)
    assert.equal(animated.value, 0xff808080)
    clock.advanceBy(50)
    assert.equal(animated.value, 0xffffffff)

    animated.stop()
})

test("createTransition derives animated values from a reactive target state", () => {
    const clock = createManualAnimationClock()
    const open = ref(false)
    const transition = createTransition(open, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }), clock })
    const width = transition.animatedDp("width", (state) => state ? 200 : 100)

    open.value = true
    clock.advanceBy(25)
    assert.equal(width.value, 125)
    clock.advanceBy(75)
    assert.equal(width.value, 200)

    width.stop()
})

test("all value groups animate on one clock and reject changing vector dimensions", async () => {
    const { animatedNumberArrayAsRef, animatedOffsetAsRef, animatedSizeAsRef, animatedRectAsRef } = await import('../../packages/framework/src/animation/index.ts')
    const clock = createManualAnimationClock()
    const args = { clock, animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }
    const vector = ref<readonly number[]>([0, 10])
    const offset = ref({ x: 0, y: 10 })
    const size = ref({ width: 20, height: 30 })
    const rect = ref({ x: 0, y: 10, width: 20, height: 30 })
    const values = [animatedNumberArrayAsRef(vector, args), animatedOffsetAsRef(offset, args), animatedSizeAsRef(size, args), animatedRectAsRef(rect, args)]
    vector.value = [10, 20]
    offset.value = { x: 10, y: 20 }
    size.value = { width: 30, height: 40 }
    rect.value = { x: 10, y: 20, width: 30, height: 40 }
    assert.equal(clock.pendingFrames, 1)
    clock.advanceBy(50)
    assert.deepEqual(values.map(value => value.value), [[5, 15], { x: 5, y: 15 }, { width: 25, height: 35 }, { x: 5, y: 15, width: 25, height: 35 }])
    assert.throws(() => { vector.value = [1] }, /fixed length/)
    values.forEach(value => value.stop())
    assert.equal(clock.pendingFrames, 0)
})

test("spring retarget preserves velocity and is independent of frame subdivision", async () => {
    const { spring } = await import('../../packages/framework/src/animation/index.ts')
    const aClock = createManualAnimationClock(), bClock = createManualAnimationClock()
    const aTarget = ref(0), bTarget = ref(0)
    const spec = spring({ stiffness: 100, dampingRatio: 0.6 })
    const a = animatedNumberAsRef(aTarget, { clock: aClock, animationSpec: spec })
    const b = animatedNumberAsRef(bTarget, { clock: bClock, animationSpec: spec })
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
    const clock = createManualAnimationClock(), target = ref(false)
    const transition = createTransition(target, { clock, animationSpec: tween({ durationMillis: 100, easing: linearEasing }) })
    const x = transition.animatedNumber('x', state => state ? 100 : 0)
    const y = transition.animatedNumber('y', state => state ? 200 : 0)
    const observed: number[][] = []
    const stopWatch = watch(() => [x.value, y.value], value => observed.push(value), { flush: 'sync' })
    target.value = true
    assert.equal(clock.pendingFrames, 1)
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
    const clock = createManualAnimationClock(), target = ref(0)
    const scope = effectScope()
    const animated = scope.run(() => animatedNumberAsRef(target, { clock, animationSpec: tween({ durationMillis: 100, delayMillis: 20, easing: linearEasing }) }))!
    target.value = 100
    clock.advanceBy(10)
    assert.equal(animated.value, 0)
    clock.advanceBy(60)
    assert.equal(animated.value, 50)
    scope.stop()
    target.value = 200
    clock.advanceBy(500)
    assert.equal(animated.value, 50)
    assert.equal(clock.pendingFrames, 0)
    const instant = animatedNumberAsRef(target, { clock, animationSpec: snap() })
    target.value = 42
    assert.equal(instant.value, 42)
    assert.equal(clock.pendingFrames, 0)
    instant.stop()
    assert.equal(animationStats.activeAnimations, baseline)
})

test("completion callbacks observe the complete frame and stopping a sibling suppresses its queued callback", () => {
    const clock = createManualAnimationClock()
    const observed: number[][] = []
    const spec = tween({ durationMillis: 100, easing: linearEasing })
    const xTarget = ref(0), yTarget = ref(0)
    const x = animatedNumberAsRef(xTarget, {
        clock, animationSpec: spec, finished() {
            observed.push([x.value, y.value])
            y.stop()
        }
    })
    const y = animatedNumberAsRef(yTarget, { clock, animationSpec: spec, finished() { throw new Error('retired completion ran') } })
    xTarget.value = 10
    yTarget.value = 20
    clock.advanceBy(100)
    assert.deepEqual(observed, [[10, 20]])
    x.stop()
})

test("group animation tracks reactive fields and bounds size overshoot", async () => {
    const { animatedOffsetAsRef, animatedSizeAsRef, spring } = await import('../../packages/framework/src/animation/index.ts')
    const clock = createManualAnimationClock(), point = ref({ x: 0, y: 0 }), size = ref({ width: 50, height: 50 })
    const offset = animatedOffsetAsRef(point, { clock, animationSpec: tween({ durationMillis: 100, easing: linearEasing }) })
    const dimensions = animatedSizeAsRef(size, { clock, animationSpec: spring({ stiffness: 100, dampingRatio: 0.1 }) })
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
    const clock = createManualAnimationClock(), target = ref(false), extent = ref(100)
    const transition = createTransition(target, { clock, animationSpec: tween({ durationMillis: 100, easing: linearEasing }) })
    const width = transition.animatedDp('width', state => state ? extent.value : 0)
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
    assert.equal(clock.pendingFrames, 0)
})