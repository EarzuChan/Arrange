import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, onScopeDispose, watch } from '../../packages/reactivity/src/index.ts'
import { defineArrangable } from '../../packages/framework/src/runtime/apiDefineArrangable.ts'
import { RearrangeSession } from '../../packages/framework/src/runtime/rearrange.ts'
import { nextTick } from '../../packages/framework/src/runtime/scheduler.ts'
import { onMounted, onUnmounted, onUpdated } from '../../packages/framework/src/runtime/apiLifecycle.ts'
import type { RearrangeHost } from '../../packages/framework/src/runtime/rearrangeNode.ts'
import type { ArrangableDefinition } from '../../packages/framework/src/runtime/arrangable.ts'

function controlledHost() {
    let complete: ((error?: Error) => void) | undefined
    const errors: unknown[] = []
    const host: RearrangeHost = {
        begin() { },
        reconcileRoots() { },
        apply(callback) { complete = callback },
        rollback() { complete = undefined },
    }
    return {
        create(definition: ArrangableDefinition) { return new RearrangeSession({ host, config: { errorHandler(error) { errors.push(error) } }, provides: {}, definitions: {} }, definition, {}) },
        finish(error?: Error) {
            assert.ok(complete, '必须存在待应用事务')
            const callback = complete
            complete = undefined
            callback(error)
        },
        errors,
    }
}

test('AB 到 AC 等待 apply 成功后才释放 B，准备阶段不发送成功通知', async () => {
    const events: string[] = []
    const selected = ref(false)
    const A = defineArrangable({ setup() { return () => { } } })
    const B = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('释放 B'))
            return () => { }
        }
    })
    const C = defineArrangable({
        setup() {
            events.push('创建 C')
            onMounted(() => events.push('挂载 C'))
            return () => { }
        }
    })
    const App = defineArrangable({
        setup(_props, { call }) {
            return () => {
                call(0, A, {})
                call(1, selected.value ? C : B, {})
            }
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    selected.value = true
    await nextTick()
    assert.deepEqual(events, ['创建 C'])
    native.finish()
    assert.deepEqual(events, ['创建 C', '释放 B', '挂载 C'])
    rearrangeSession.dispose()
})

test('创建 C 失败且被接住时保留 B 的实例与旧作用域，修正后可重试', async () => {
    const selected = ref(false)
    const revision = ref(0)
    const events: string[] = []
    let fail = true
    const B = defineArrangable({
        setup() {
            events.push('创建 B')
            onScopeDispose(() => events.push('释放 B'))
            return () => { }
        }
    })
    const C = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('清理 C'))
            if (fail) throw new Error('创建 C 失败')
            return () => { }
        }
    })
    const App = defineArrangable({
        setup(_props, { call }) {
            return () => {
                revision.value
                call(0, selected.value ? C : B, {})
            }
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    selected.value = true
    await nextTick()
    assert.equal(native.errors.length, 1)
    assert.deepEqual(events, ['创建 B', '清理 C'])

    fail = false
    revision.value++
    await nextTick()
    assert.deepEqual(events, ['创建 B', '清理 C'])
    native.finish()
    assert.deepEqual(events, ['创建 B', '清理 C', '释放 B'])
    rearrangeSession.dispose()
})

test('后端 apply 失败不释放旧实例，只清理候选，不触发候选成功生命周期', async () => {
    const selected = ref(false)
    const events: string[] = []
    const B = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('释放 B'))
            return () => { }
        }
    })
    const C = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('清理 C'))
            onMounted(() => events.push('挂载 C'))
            onUnmounted(() => events.push('卸载 C'))
            return () => { }
        }
    })
    const App = defineArrangable({ setup(_props, { call }) { return () => call(0, selected.value ? C : B, {}) } })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    selected.value = true
    await nextTick()
    native.finish(new Error('应用失败'))
    assert.equal(native.errors.length, 1)
    assert.deepEqual(events, ['清理 C'])
    rearrangeSession.dispose()
    assert.deepEqual(events, ['清理 C', '释放 B'])
})


test('独立参数同时变化先完成整组校验，观察者不读取半套上下限', async () => {
    const lower = ref(1)
    const upper = ref(2)
    const observed: number[][] = []
    const Range = defineArrangable({
        props: { lower: { type: Number, required: true, validator: (value: unknown, props: Record<string, unknown>) => Number(value) <= Number(props.upper) }, upper: { type: Number, required: true } },
        setup(props) {
            watch(() => [props.lower, props.upper], values => observed.push(values))
            return () => { }
        },
    })
    const App = defineArrangable({ setup: (_props, { call }) => () => call(0, Range, { lower: () => lower.value, upper: () => upper.value }) })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    lower.value = 3
    upper.value = 4
    await nextTick()
    assert.deepEqual(native.errors, [])
    assert.deepEqual(observed, [[3, 4]])
    native.finish()
    rearrangeSession.dispose()
})

test('纯值 apply 失败恢复旧参数和求值缓存，再次变化能够正确提交', async () => {
    const value = ref(1)
    let props: Readonly<{ value: number }>
    const Child = defineArrangable({
        props: { value: { type: Number, required: true } }, setup(values) {
            props = values
            return () => { }
        }
    })
    const App = defineArrangable({ setup: (_props, { call }) => () => call(0, Child, { value: () => value.value }) })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    value.value = 2
    await nextTick()
    native.finish(new Error('拒绝此次参数更新'))
    assert.equal(props!.value, 1)
    assert.equal(native.errors.length, 1)

    value.value = 3
    await nextTick()
    native.finish()
    assert.equal(props!.value, 3)
    rearrangeSession.dispose()
})

test('候选嵌套调用回滚不发送任何成功卸载通知，深层退出只清理一次', async () => {
    const visible = ref(false)
    const events: string[] = []
    const Leaf = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('清理叶子'))
            onUnmounted(() => events.push('卸载叶子'))
            return () => { }
        }
    })
    const Branch = defineArrangable({ setup: (_props, { call }) => () => call(0, Leaf, {}) })
    const App = defineArrangable({ setup: (_props, { call }) => () => { if (visible.value) call(0, Branch, {}) } })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    visible.value = true
    await nextTick()
    native.finish(new Error('拒绝候选分支'))
    assert.deepEqual(events, ['清理叶子'])
    rearrangeSession.dispose()
    assert.deepEqual(events, ['清理叶子'])
})

test('两千层结构建立和退休不依赖递归调用栈', () => {
    let disposed = 0
    const Nested = defineArrangable({
        props: { depth: { type: Number, required: true } },
        setup(props, { call }) {
            onScopeDispose(() => disposed++)
            return () => { if (props.depth > 0) call(0, Nested, { depth: () => props.depth - 1 }) }
        },
    })
    const App = defineArrangable({ setup: (_props, { call }) => () => call(0, Nested, { depth: () => 2000 }) })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()
    rearrangeSession.dispose()
    assert.equal(disposed, 2001)
})


test('结构代码自行捕获创建异常也不能把失败候选提交成空输出', async () => {
    const selected = ref(false)
    const events: string[] = []
    const B = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('释放 B'))
            return () => { }
        }
    })
    const C = defineArrangable({ setup() { throw new Error('创建失败') } })
    const App = defineArrangable({
        setup: (_props, { call }) => () => {
            try { call(0, selected.value ? C : B, {}) } catch { events.push('业务接住异常') }
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()

    selected.value = true
    await nextTick()
    assert.deepEqual(events, ['业务接住异常'])
    assert.equal(native.errors.length, 1)
    assert.throws(() => native.finish(), /必须存在待应用事务/)
    rearrangeSession.dispose()
    assert.deepEqual(events, ['业务接住异常', '释放 B'])
})


test('同一事务内二次失效复用候选实例，并只发送一次成功通知', () => {
    const selected = ref(0)
    let setups = 0
    let mounts = 0
    let evaluations = 0
    const Child = defineArrangable({
        setup() {
            setups++
            onMounted(() => mounts++)
            return () => { }
        }
    })
    const Mutator = defineArrangable({ setup: () => () => { selected.value = 1 } })
    const App = defineArrangable({
        setup: (_props, { call }) => () => {
            evaluations++
            selected.value
            call(0, Child, {})
            call(1, Mutator, {})
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()
    assert.equal(evaluations, 2)
    assert.equal(setups, 1)
    assert.equal(mounts, 1)
    rearrangeSession.dispose()
})

test('成功回调抛错不撤销已提交状态，后续通知和更新继续执行', async () => {
    const value = ref(0)
    const events: string[] = []
    const App = defineArrangable({
        setup() {
            onMounted(() => {
                events.push('挂载')
                throw new Error('业务挂载通知失败')
            })
            onMounted(() => events.push('第二个挂载通知'))
            onUpdated(() => events.push('更新'))
            return () => { value.value }
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()
    assert.equal(native.errors.length, 1)
    assert.deepEqual(events, ['挂载', '第二个挂载通知'])

    value.value++
    await nextTick()
    native.finish()
    assert.deepEqual(events, ['挂载', '第二个挂载通知', '更新'])
    rearrangeSession.dispose()
})

test('候选清理抛错仍释放其余资源，保留旧生命且允许重试', async () => {
    const selected = ref(false)
    const revision = ref(0)
    const events: string[] = []
    const B = defineArrangable({
        setup() {
            onScopeDispose(() => events.push('释放 B'))
            return () => { }
        }
    })
    const C = defineArrangable({
        setup() {
            onScopeDispose(() => {
                events.push('清理一')
                throw new Error('业务清理失败')
            })
            onScopeDispose(() => events.push('清理二'))
            return () => { }
        }
    })
    const App = defineArrangable({
        setup: (_props, { call }) => () => {
            revision.value
            call(0, selected.value ? C : B, {})
        }
    })
    const native = controlledHost()
    const rearrangeSession = native.create(App)
    rearrangeSession.mount()
    native.finish()
    selected.value = true
    await nextTick()
    native.finish(new Error('拒绝应用'))
    assert.deepEqual(events, ['清理一', '清理二'])
    assert.equal(native.errors.length, 1)

    selected.value = false
    revision.value++
    await nextTick()
    native.finish()
    rearrangeSession.dispose()
    assert.deepEqual(events, ['清理一', '清理二', '释放 B'])
})

test('开启事务失败能清理运行状态，之后可以重新挂载', () => {
    let fail = true
    let rollbacks = 0
    const host: RearrangeHost = {
        begin() { if (fail) throw new Error('开启事务失败') },
        reconcileRoots() { },
        apply(complete) { complete() },
        rollback() { rollbacks++ },
    }
    const App = defineArrangable({ setup: () => () => { } })
    const rearrangeSession = new RearrangeSession({ host, config: {}, provides: {}, definitions: {} }, App, {})
    assert.throws(() => rearrangeSession.mount(), /开启事务失败/)
    assert.equal(rollbacks, 1)
    fail = false
    rearrangeSession.mount()
    assert.equal(rearrangeSession.root.entries.length, 1)
    rearrangeSession.dispose()
})