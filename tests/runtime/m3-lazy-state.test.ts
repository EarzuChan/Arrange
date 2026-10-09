import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, createLazyState, nextTick, shallowRef, ref, type LazyState } from '@arrange/framework'
import { KeepAlive, LazyColumn, Text } from '@arrange/framework/foundation'
import { defineArrangable } from '@arrange/framework/internal'
import { Modifier } from '../../packages/framework/src/modifier.ts'
import { lazyStateAppliedRequestVersion, lazyStateRequest } from '../../packages/framework/src/lazy.ts'
import { linearEasing, tween } from '../../packages/framework/src/animation/value.ts'
import { recordingNative, type RecordedLayoutNode } from './recordingNative.ts'

const animationSpec = tween({ durationMillis: 1000, easing: linearEasing })
const Item = defineArrangable({
    props: { index: Number }, setup(props, { call }) {
        return () => call(0, Text, { text: () => String(props.index) })
    }
})
const items = Array.from({ length: 100 }, (_, index) => index)
function lazyNodes(nodes: Map<number, RecordedLayoutNode>): RecordedLayoutNode[] {
    return [...nodes.values()].filter(node => (node.inputs.get('measurePolicy') as { kind?: string } | undefined)?.kind === 'Lazy')
}
function policy(node: RecordedLayoutNode) { return node.inputs.get('measurePolicy') as { requestedIndex: number; requestedOffset: number; requestVersion: number } }
function scrollValue(node: RecordedLayoutNode): number {
    const scroll = (node.inputs.get('modifier') as Modifier).elements.find(element => element.type === 'verticalScroll')!
    return (scroll.value.state as { value: number }).value
}
function rootFor(source: { value: LazyState | undefined }) {
    return defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, { items: () => items, itemContent: () => Item, itemProps: () => (index: number) => ({ index }), state: () => source.value })
        }
    })
}

test('Lazy 动态 state 在成功回执交接，失败恢复旧 owner 并结束候选动画', async () => {
    const native = recordingNative(false)
    const a = createLazyState({ firstVisibleItemIndex: 1, firstVisibleItemScrollOffset: 2 })
    const b = createLazyState({ firstVisibleItemIndex: 5, firstVisibleItemScrollOffset: 7 })
    const source = shallowRef<LazyState | undefined>(a)
    const errors: unknown[] = []
    const app = createApp(rootFor(source))
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    assert.equal(policy(lazyNodes(native.candidateNodes!)[0]).requestedIndex, 1)
    native.finish()
    const aNativeVersion = policy(lazyNodes(native.nodes)[0]).requestVersion
    let aFinished = false, bFinished = false
    const oldAnimation = a.animateScrollToItem(20, 0, animationSpec).then(() => { aFinished = true })
    source.value = b
    await nextTick()
    native.frame()
    const candidate = lazyNodes(native.candidateNodes!)[0]
    assert.deepEqual([policy(candidate).requestedIndex, policy(candidate).requestedOffset, scrollValue(candidate)], [5, 7, 0])
    assert.ok(policy(candidate).requestVersion > aNativeVersion, '两个 state 自有 requestVersion 相同仍须交付新的原生请求')
    assert.equal(a.isScrollInProgress, true)
    const candidateAnimation = b.animateScrollToItem(30, 0, animationSpec).then(() => { bFinished = true })
    assert.equal(b.isScrollInProgress, true)
    native.finish('拒绝 state 切换')
    await candidateAnimation
    assert.equal(errors.length, 1)
    assert.equal(aFinished, false)
    assert.equal(a.isScrollInProgress, true)
    assert.equal(bFinished, true)
    assert.equal(b.isScrollInProgress, false)
    assert.equal(lazyStateAppliedRequestVersion(b), 0)
    assert.equal(policy(lazyNodes(native.nodes)[0]).requestedIndex, 1)

    source.value = a
    await nextTick()
    native.frame()
    native.finish()
    source.value = b
    await nextTick()
    native.frame()
    assert.equal(a.isScrollInProgress, true)
    native.finish()
    await oldAnimation
    assert.equal(aFinished, true)
    assert.equal(a.isScrollInProgress, false)
    assert.equal(policy(lazyNodes(native.nodes)[0]).requestedIndex, 5)
    const bNativeVersion = policy(lazyNodes(native.nodes)[0]).requestVersion
    source.value = a
    await nextTick()
    native.frame()
    assert.equal(policy(lazyNodes(native.candidateNodes!)[0]).requestVersion, bNativeVersion, '切回已应用 state 恢复 value，不能重放旧 scrollToItem')
    native.finish()
    source.value = b
    await nextTick()
    native.frame()
    native.finish()
    await a.animateScrollToItem(42, 3, animationSpec)
    assert.equal(a.isScrollInProgress, false)
    assert.equal(lazyStateRequest(a).index, 42)
    const active = b.animateScrollToItem(31, 0, animationSpec)
    assert.equal(b.isScrollInProgress, true)
    app.unmount()
    await active
    assert.equal(b.isScrollInProgress, false)
})

test('Lazy 两个活跃 Layout 可在同一候选交换 state，重复连接仍拒绝并恢复', async () => {
    const native = recordingNative(false)
    const a = createLazyState({ firstVisibleItemIndex: 2 }), b = createLazyState({ firstVisibleItemIndex: 8 })
    const first = shallowRef(a), second = shallowRef(b)
    const errors: unknown[] = []
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => {
                call(0, LazyColumn, { items: () => items, itemContent: () => Item, state: () => first.value })
                call(1, LazyColumn, { items: () => items, itemContent: () => Item, state: () => second.value })
            }
        }
    }))
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    native.finish()
    first.value = b
    second.value = a
    await nextTick()
    native.frame()
    assert.deepEqual(lazyNodes(native.candidateNodes!).map(node => policy(node).requestedIndex), [8, 2])
    native.finish()
    first.value = a
    await nextTick()
    native.frame()
    assert.equal(errors.length, 1)
    assert.match(String(errors[0]), /只能连接一个存活/)
    assert.equal(native.candidateNodes, undefined)
    assert.deepEqual(lazyNodes(native.nodes).map(node => policy(node).requestedIndex), [8, 2])
    const animation = b.animateScrollToItem(15, 0, animationSpec)
    assert.equal(b.isScrollInProgress, true)
    app.unmount()
    await animation
})

test('Lazy 缺省 state 是稳定实例，显式 state 移除后恢复其位置和待消费请求', async () => {
    const native = recordingNative(false)
    const source = shallowRef<LazyState | undefined>(undefined)
    const b = createLazyState({ firstVisibleItemIndex: 12 })
    const app = createApp(rootFor(source))
    app.mount(native.target)
    native.frame()
    native.finish()
    const first = lazyNodes(native.nodes)[0]
    const scroll = (first.inputs.get('modifier') as Modifier).elements.find(element => element.type === 'verticalScroll')!
    const feedback = (scroll.value.state as { __arrangeNativeScroll: (value: object) => void }).__arrangeNativeScroll
    feedback({ value: 64, firstVisibleItemIndex: 3, firstVisibleItemScrollOffset: 4 })
    source.value = b
    await nextTick()
    native.frame()
    native.finish()
    source.value = undefined
    await nextTick()
    native.frame()
    assert.equal(scrollValue(lazyNodes(native.candidateNodes!)[0]), 64)
    assert.equal(policy(lazyNodes(native.candidateNodes!)[0]).requestedIndex, 0)
    native.finish()
    app.unmount()
})

test('同一材料化候选 A→B→A 只保留最终 state owner，失败也恢复原 owner', async () => {
    const native = recordingNative(false)
    const a = createLazyState({ firstVisibleItemIndex: 2 }), b = createLazyState({ firstVisibleItemIndex: 8 })
    const source = shallowRef<LazyState | undefined>(a)
    let switchDuringMaterialize = false
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, {
                items: () => items, itemContent: () => Item,
                itemProps: () => (index: number) => {
                    if (switchDuringMaterialize) source.value = index === 1 ? b : a
                    return { index }
                }, state: () => source.value
            })
        }
    }))
    const errors: unknown[] = []
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    const id = lazyNodes(native.candidateNodes!)[0].id
    native.materialize(id, [0])
    native.finish()
    switchDuringMaterialize = true
    a.scrollToItem(1)
    await nextTick()
    native.frame()
    native.materialize(id, [1])
    assert.equal(policy(lazyNodes(native.candidateNodes!)[0]).requestedIndex, 8)
    native.materialize(id, [2])
    assert.equal(policy(lazyNodes(native.candidateNodes!)[0]).requestedIndex, 1)
    native.finish()
    assert.deepEqual(errors, [])
    await b.animateScrollToItem(12, 0, animationSpec)
    assert.equal(b.isScrollInProgress, false)
    const active = a.animateScrollToItem(20, 0, animationSpec)
    assert.equal(a.isScrollInProgress, true)
    app.unmount()
    await active
})

test('KeepAlive 成功停用才结束 Lazy 动画，恢复失败保留旧 owner，隐藏请求恢复时消费', async () => {
    const native = recordingNative(false)
    const state = createLazyState()
    const page = ref('lazy')
    const source = shallowRef<LazyState | undefined>(state)
    let setups = 0
    const Page = defineArrangable({
        setup(_props, { call }) {
            setups++
            return () => call(0, LazyColumn, { items: () => items, itemContent: () => Item, state: () => source.value })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, KeepAlive, { cacheKey: () => page.value }, {
                default: () => {
                    if (page.value === 'lazy') call(0, Page, {})
                    else call(1, Text, { text: () => '空页' })
                }
            })
        }
    }))
    const errors: unknown[] = []
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    native.finish()
    let done = false
    const active = state.animateScrollToItem(20, 0, animationSpec).then(() => { done = true })
    page.value = 'empty'
    await nextTick()
    native.frame()
    assert.equal(state.isScrollInProgress, true)
    native.finish('拒绝停用')
    assert.equal(done, false)
    assert.equal(state.isScrollInProgress, true)
    page.value = 'lazy'
    await nextTick()
    native.frame()
    native.finish()
    page.value = 'empty'
    await nextTick()
    native.frame()
    native.finish()
    await active
    assert.equal(done, true)
    assert.equal(state.isScrollInProgress, false)
    await state.animateScrollToItem(25, 6, animationSpec)
    assert.equal(state.isScrollInProgress, false)
    assert.equal(lazyStateRequest(state).index, 25)
    page.value = 'lazy'
    await nextTick()
    native.frame()
    assert.ok(native.candidateNodes, errors.map(String).join('\n'))
    native.finish('拒绝恢复')
    assert.equal(lazyNodes(native.nodes).length, 0)
    page.value = 'empty'
    await nextTick()
    native.frame()
    native.finish()
    page.value = 'lazy'
    await nextTick()
    native.frame()
    assert.deepEqual([policy(lazyNodes(native.candidateNodes!)[0]).requestedIndex, policy(lazyNodes(native.candidateNodes!)[0]).requestedOffset], [25, 6])
    native.finish()
    assert.equal(setups, 1)
    assert.equal(errors.length, 2)
    const resumed = state.animateScrollToItem(26, 0, animationSpec)
    assert.equal(state.isScrollInProgress, true)
    app.unmount()
    await resumed
})
