import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, nextTick, onBeforeMount, onMounted, onScopeDispose, ref, watch, type ArrangeApp } from '@arrange/framework'
import { Text } from '@arrange/framework/foundation'
import { defineArrangable } from '@arrange/framework/internal'
import { FrameScheduler, type SchedulerJob } from '../../packages/framework/src/runtime/scheduler.ts'
import { scheduleFrameDeadline } from '../../packages/framework/src/runtime/frameDeadline.ts'
import { RearrangeSession } from '../../packages/framework/src/runtime/rearrange.ts'
import type { RearrangeHost } from '../../packages/framework/src/runtime/rearrangeNode.ts'
import { frameScope } from './frameScope.ts'
import { recordingNative } from './recordingNative.ts'

test('nextTick 交付普通语义观察和回调，UI 失效仍等待同一宿主帧', async () => {
    const value = ref(0)
    const events: string[] = []
    const semantic = watch(value, next => events.push(`语义：${next}`))
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            watch(value, next => events.push(`帧前：${next}`))
            return () => call(0, Text, { text: () => String(value.value) })
        }
    }))
    app.mount(native.target)
    native.frame()
    const submissions = native.submissions
    value.value = 1
    events.push('同步')
    const receiver = { name: '回调' }
    const tick = nextTick<typeof receiver, void>
    await tick.call(receiver, function() { events.push(this.name) })
    assert.deepEqual(events, ['同步', '语义：1', '回调'])
    assert.equal(native.submissions, submissions)
    assert.equal(native.textNodes()[0].text, '0')
    native.frame()
    assert.deepEqual(events, ['同步', '语义：1', '回调', '帧前：1'])
    assert.equal(native.textNodes()[0].text, '1')
    semantic.stop()
    app.unmount()
})

test('动画采样、帧前任务和提交后任务中的销毁均终止剩余工作且不能复活调度器', () => {
    for (const phase of ['animation', 'pre', 'post'] as const) {
        const requests: boolean[] = []
        const events: string[] = []
        const scheduler = new FrameScheduler(pending => requests.push(pending))
        const dispose = () => {
            events.push('销毁')
            scheduler.dispose()
        }
        if (phase === 'animation') {
            scheduler.add({ active: () => true, sample: dispose })
            scheduler.add({ active: () => true, sample: () => events.push('迟到采样') })
        } else {
            scheduler.enqueue(dispose, phase)
            scheduler.enqueue(() => events.push('迟到任务'), phase)
        }
        scheduler.prepare(1)
        scheduler.complete(true)
        const frames = scheduler.counters.frames
        const commits = scheduler.counters.commits
        scheduler.enqueue(() => events.push('复活任务'), 'pre')
        scheduler.prepare(2)
        scheduler.complete(true)
        assert.deepEqual(events, ['销毁'], phase)
        assert.equal(scheduler.counters.frames, frames, phase)
        assert.equal(scheduler.counters.commits, commits, phase)
        assert.equal(requests.at(-1), false, phase)
        assert.throws(() => scheduler.add({ active: () => true, sample() { } }), /已销毁/, phase)
    }
})

test('帧期限完成、取消和作用域销毁及时移除所有订阅及清理项', () => {
    const owner = frameScope()
    const events: string[] = []
    const assertReleased = () => {
        assert.equal(owner.scope.cleanups.length, 0)
        assert.equal(owner.scope.pauseCallbacks.size, 0)
        assert.equal(owner.scope.resumeCallbacks.size, 0)
    }
    owner.run(() => {
        for (let index = 0; index < 100; index++) {
            const cancel = scheduleFrameDeadline(100, () => events.push('取消后不应触发'))
            cancel()
            cancel()
        }
        assertReleased()
        scheduleFrameDeadline(16, () => events.push('到期'))
    })
    owner.advanceBy(16)
    assert.deepEqual(events, ['到期'])
    assertReleased()
    owner.run(() => scheduleFrameDeadline(16, () => events.push('销毁后不应触发')))
    owner.stop()
    assertReleased()
    owner.advanceBy(16)
    assert.deepEqual(events, ['到期'])
})

test('候选等待 apply 时最终销毁立即清理，迟到成功回执不通知也不恢复内容', () => {
    const events: string[] = []
    let completion: ((error?: Error) => void) | undefined
    const host: RearrangeHost = {
        currentTime: () => 0,
        requestFrame() { },
        begin() { },
        reconcileRoots() { },
        apply(callback) { completion = callback },
        rollback() { },
    }
    const definition = defineArrangable({
        setup() {
            onMounted(() => events.push('挂载'))
            onScopeDispose(() => events.push('释放'))
            return () => { }
        }
    })
    const session = new RearrangeSession({ host, config: {}, provides: {}, definitions: {} }, definition, {})
    session.mount()
    session.scheduler.prepare(0)
    assert.ok(completion)
    assert.deepEqual(events, [])
    session.dispose()
    assert.deepEqual(events, ['释放'])
    completion()
    session.scheduler.complete(true)
    session.scheduler.prepare(1)
    assert.deepEqual(events, ['释放'])
    assert.equal(session.root.entries.length, 0)
})

test('setup 与挂载生命周期主动卸载立即清理，剩余结构和通知不访问已关闭宿主', () => {
    for (const phase of ['setup', 'beforeMount', 'mounted'] as const) {
        const events: string[] = []
        const errors: unknown[] = []
        const native = recordingNative()
        let app: ArrangeApp
        app = createApp(defineArrangable({
            setup(_props, { call }) {
                onScopeDispose(() => events.push('释放'))
                if (phase === 'setup') app.unmount()
                if (phase === 'beforeMount') onBeforeMount(() => app.unmount())
                if (phase === 'mounted') onMounted(() => app.unmount())
                onMounted(() => events.push('迟到挂载通知'))
                return () => {
                    events.push('结构')
                    call(0, Text, { text: () => '不应留下节点' })
                }
            }
        }))
        app.config.errorHandler = error => errors.push(error)
        app.mount(native.target)
        native.frame()
        assert.deepEqual(errors, [], phase)
        assert.deepEqual(events, phase === 'mounted' ? ['结构', '释放'] : ['释放'], phase)
        assert.equal(native.nodes.size, 0, phase)
        assert.equal(native.pendingFrame, false, phase)
        assert.equal(native.submissions, Number(phase === 'mounted'), phase)
        const replacement = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, Text, { text: () => '新应用' }) }))
        replacement.mount(native.target)
        native.frame()
        assert.equal(native.textNodes()[0].text, '新应用', phase)
        replacement.unmount()
    }
})

test('参数传播中的帧前观察或结构执行主动卸载撤销候选，失效任务不复活', () => {
    for (const phase of ['watch', 'structure'] as const) {
        const count = ref(0)
        const errors: unknown[] = []
        const native = recordingNative()
        let released = 0
        let app: ArrangeApp
        const Child = defineArrangable({
            props: { count: { type: Number, required: true } },
            setup(props, { call }) {
                onScopeDispose(() => released++)
                if (phase === 'watch') watch(() => props.count, () => app.unmount())
                return () => {
                    if (phase === 'structure' && props.count > 0) app.unmount()
                    call(0, Text, { text: () => String(props.count) })
                }
            }
        })
        app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, Child, { count: () => count.value }) }))
        app.config.errorHandler = error => errors.push(error)
        app.mount(native.target)
        native.frame()
        assert.equal(native.textNodes()[0].text, '0')
        const submissions = native.submissions
        count.value = 1
        native.frame()
        assert.deepEqual(errors, [], phase)
        assert.equal(released, 1, phase)
        assert.equal(native.nodes.size, 0, phase)
        assert.equal(native.submissions, submissions, phase)
        count.value = 2
        native.frame()
        assert.equal(native.pendingFrame, false, phase)
        assert.equal(released, 1, phase)
    }
})

test('setup 失败及卸载取消中的清理错误保留原错误并完成其余清理', () => {
    const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error]
    for (const phase of ['setup', 'unmount', 'unmountThenSetup'] as const) {
        const primary = new Error('setup 业务错误')
        const cleanup = new Error('释放业务资源失败')
        const errors: unknown[] = []
        const events: string[] = []
        const native = recordingNative()
        let app: ArrangeApp
        app = createApp(defineArrangable({
            setup() {
                onScopeDispose(() => {
                    events.push('第一项清理')
                    throw cleanup
                })
                onScopeDispose(() => events.push('第二项清理'))
                onMounted(() => events.push('不应挂载'))
                if (phase !== 'setup') app.unmount()
                if (phase !== 'unmount') throw primary
                return () => { }
            }
        }))
        app.config.errorHandler = error => errors.push(error)
        app.mount(native.target)
        native.frame()
        assert.deepEqual(events, ['第一项清理', '第二项清理'], phase)
        assert.equal(errors.length, 1, phase)
        assert.ok(errors[0] instanceof AggregateError, phase)
        const causes = leaves(errors[0])
        assert.ok(causes.includes(cleanup), phase)
        if (phase !== 'unmount') assert.equal(causes[0], primary, phase)
        assert.equal(native.nodes.size, 0, phase)
        assert.equal(native.submissions, 0, phase)
        assert.equal(native.pendingFrame, false, phase)
        app.unmount()
        assert.deepEqual(events, ['第一项清理', '第二项清理'], phase)
    }
})

test('已挂载 App 最终卸载的业务清理异常传给调用者，其他资源和宿主仍释放', () => {
    const cleanup = new Error('最终清理失败')
    const events: string[] = []
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            onScopeDispose(() => { throw cleanup })
            onScopeDispose(() => events.push('其余资源释放'))
            return () => call(0, Text, { text: () => '已挂载' })
        }
    }))
    app.mount(native.target)
    native.frame()
    assert.throws(() => app.unmount(), error => {
        assert.ok(error instanceof AggregateError)
        const leaves = (failure: unknown): unknown[] => failure instanceof AggregateError ? failure.errors.flatMap(leaves) : [failure]
        return leaves(error).includes(cleanup)
    })
    assert.deepEqual(events, ['其余资源释放'])
    assert.equal(native.nodes.size, 0)
    assert.equal(native.pendingFrame, false)
    app.unmount()
    assert.deepEqual(events, ['其余资源释放'])
})

test('提交后失效只进入下一帧，失败提交不交付 post 观察', () => {
    const requests: boolean[] = []
    const events: string[] = []
    const scheduler = new FrameScheduler(pending => requests.push(pending))
    const collect: SchedulerJob = () => events.push('收集')
    const post: SchedulerJob = () => {
        events.push('提交后')
        scheduler.enqueue(collect, 'collect')
    }
    scheduler.enqueue(post, 'post')
    scheduler.prepare(0)
    scheduler.complete(false)
    assert.deepEqual(events, [])
    scheduler.enqueue(post, 'post')
    scheduler.prepare(1)
    scheduler.complete(true)
    assert.deepEqual(events, ['提交后'])
    assert.equal(requests.at(-1), true)
    scheduler.prepare(2)
    assert.deepEqual(events, ['提交后', '收集'])
    scheduler.complete(true)
    assert.equal(requests.at(-1), false)
    scheduler.dispose()
})
