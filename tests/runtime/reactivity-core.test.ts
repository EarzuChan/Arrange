import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectFlags, ReactiveEffect, batchUpdates, computed, effect, effectScope, getCurrentScope, onEffectCleanup, onScopeDispose, reactive, ref, stop, toRaw, watch } from '@arrange/reactivity'
import type { Dep } from '../../packages/reactivity/src/dep.ts'

test('computed 缓存按真实依赖更新，分支退出退订且相等结果不通知消费者', () => {
    const state = reactive({ chooseLeft: true, left: 2, right: 4 })
    let evaluations = 0
    const parity = computed(() => {
        evaluations++
        return (state.chooseLeft ? state.left : state.right) % 2
    })
    const observed: number[] = []
    const runner = effect(() => observed.push(parity.value))
    assert.equal(parity.value, 0)
    assert.equal(evaluations, 1)

    state.left = 6
    assert.equal(evaluations, 2)
    assert.deepEqual(observed, [0])
    state.chooseLeft = false
    state.left = 7
    assert.equal(evaluations, 3)
    state.right = 5
    assert.deepEqual(observed, [0, 1])
    assert.equal(evaluations, 4)
    stop(runner)
    state.right = 8
    assert.deepEqual(observed, [0, 1])
    assert.equal(parity.value, 0)
})

test('常量 computed 不因无关变化重算，可写 computed 保持正式 setter', () => {
    const source = ref(2)
    let evaluations = 0
    const constant = computed(() => {
        evaluations++
        return 7
    })
    const doubled = computed({ get: () => source.value * 2, set: value => { source.value = value / 2 } })
    assert.equal(constant.value, 7)
    doubled.value = 10
    assert.equal(source.value, 5)
    assert.equal(doubled.value, 10)
    assert.equal(constant.value, 7)
    assert.equal(evaluations, 1)
})

test('响应式数组与 Map/Set 迭代使用真实代理，重复结果不产生多次执行', () => {
    const rawKey = {}
    const proxyKey = reactive(rawKey)
    const state = reactive({ values: [1, 2], map: new Map<object, number>(), set: new Set<number>() })
    const observed: unknown[] = []
    const runner = effect(() => observed.push([state.values.join(','), [...state.map.values()], [...state.set]]))
    batchUpdates(() => {
        state.values.splice(0, 1, 3)
        state.map.set(proxyKey, 4)
        state.set.add(5)
    })
    assert.equal(state.map.get(rawKey), 4)
    assert.equal(toRaw(state.map).has(rawKey), true)
    assert.deepEqual(observed, [['1,2', [], []], ['3,2', [4], [5]]])
    state.map.set(rawKey, 4)
    state.set.add(5)
    assert.equal(observed.length, 2)
    batchUpdates(() => {
        state.map.clear()
        state.set.delete(5)
        state.values.length = 1
    })
    assert.deepEqual(observed[2], ['3', [], []])
    stop(runner)
})

test('watch 的深度、once 与清理分别遵守声明，停止后不再执行', () => {
    const state = reactive({ nested: { count: 0 } })
    const shallow: number[] = []
    const deep: number[] = []
    const shallowWatch = watch(() => state, () => shallow.push(state.nested.count), { deep: 1 })
    const deepWatch = watch(() => state, () => deep.push(state.nested.count), { deep: 2 })
    state.nested.count = 1
    assert.deepEqual(shallow, [])
    assert.deepEqual(deep, [1])
    state.nested = { count: 2 }
    assert.deepEqual(shallow, [2])
    assert.deepEqual(deep, [1, 2])
    shallowWatch.stop()
    deepWatch.stop()

    const events: string[] = []
    watch(() => state.nested.count, (value, oldValue, cleanup) => {
        events.push(`${oldValue}->${value}`)
        cleanup(() => events.push('清理'))
    }, { once: true })
    state.nested.count = 3
    state.nested.count = 4
    assert.deepEqual(events, ['2->3', '清理'])
})

test('副作用退休即使清理抛错也完成 onStop，重复停止不重新释放资源', () => {
    const source = ref(0)
    const events: string[] = []
    const cleanupError = new Error('清理失败')
    const stopError = new Error('停止通知失败')
    const runner = effect(() => {
        events.push(`执行 ${source.value}`)
        onEffectCleanup(() => {
            events.push('清理')
            throw cleanupError
        })
    }, {
        onStop: () => {
            events.push('停止')
            throw stopError
        }
    })
    assert.throws(() => stop(runner), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [cleanupError, stopError])
        return true
    })
    assert.equal(runner.effect.flags & EffectFlags.ACTIVE, 0)
    stop(runner)
    source.value = 1
    assert.deepEqual(events, ['执行 0', '清理', '停止'])
})

test('作用域暂停传播到子作用域，恢复只读取最新值，失败清理不阻止其余资源退休', () => {
    const source = ref(0)
    const observed: number[] = []
    const events: string[] = []
    const owner = effectScope()
    owner.run(() => {
        assert.equal(getCurrentScope(), owner)
        const child = effectScope()
        child.run(() => effect(() => observed.push(source.value)))
        onScopeDispose(() => {
            events.push('失败资源')
            throw new Error('退休失败')
        })
        onScopeDispose(() => events.push('其余资源'))
    })
    assert.equal(getCurrentScope(), undefined)
    owner.pause()
    source.value = 1
    source.value = 2
    assert.deepEqual(observed, [0])
    owner.resume()
    assert.deepEqual(observed, [0, 2])
    assert.throws(() => owner.stop(), AggregateError)
    assert.equal(owner.active, false)
    source.value = 3
    owner.stop()
    assert.deepEqual(observed, [0, 2])
    assert.deepEqual(events, ['失败资源', '其余资源'])
})

test('批量更新完整发布同步观察结果，副作用清理中的读取不新增依赖', () => {
    const first = ref(0)
    const second = ref(0)
    const unrelated = ref(0)
    const observed: number[][] = []
    const runner = effect(() => {
        observed.push([first.value, second.value])
        onEffectCleanup(() => { void unrelated.value })
    })
    batchUpdates(() => {
        first.value = 1
        second.value = 2
    })
    unrelated.value = 3
    assert.deepEqual(observed, [[0, 0], [1, 2]])
    stop(runner)
})

test('运行中的副作用停止后读取不重新订阅，旧追踪链接也随执行退出释放', () => {
    const before = ref(0)
    const after = ref(1)
    const unused = ref(0)
    const dependency = (value: object) => (value as { dep: Dep }).dep
    let triggers = 0
    let retiring = false
    const owner = new ReactiveEffect(() => {
        void before.value
        if (!retiring) {
            void unused.value
            return 0
        }
        owner.stop()
        return after.value
    })
    owner.onTrigger = () => { triggers++ }
    assert.equal(owner.run(), 0)
    retiring = true
    assert.equal(owner.run(), 1)
    assert.equal(owner.flags & EffectFlags.ACTIVE, 0)
    assert.equal(owner.deps, undefined)
    for (const value of [before, after, unused]) {
        assert.equal(dependency(value).subs, undefined)
        assert.equal(dependency(value).activeLink, undefined)
        assert.equal(dependency(value).sc, 0)
    }
    before.value = 2
    after.value = 3
    unused.value = 4
    assert.equal(triggers, 0)
})
