import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, createLazyState, onMounted, onUnmounted, ref, nextTick } from '@arrange/framework'
import { LazyColumn, LazyVerticalGrid, Text } from '@arrange/framework/foundation'
import { defineArrangable } from '@arrange/framework/internal'
import { GridItemSpan } from '../../packages/framework/src/primitives.ts'
import type { Modifier } from '../../packages/framework/src/modifier.ts'
import { recordingNative, type RecordedLayoutNode } from './recordingNative.ts'

function lazyNode(nodes: Map<number, RecordedLayoutNode>): RecordedLayoutNode {
    const result = [...nodes.values()].find(node => (node.inputs.get('measurePolicy') as { kind?: string } | undefined)?.kind === 'Lazy')
    assert.ok(result)
    return result
}

test('Lazy 多次测量子组合延续单一候选，失败保留旧项且不提前通知生命周期', async () => {
    const native = recordingNative(false)
    const state = createLazyState()
    const mounted: number[] = []
    const unmounted: number[] = []
    const Item = defineArrangable({
        props: { value: Number }, setup(props, { call }) {
            onMounted(() => mounted.push(props.value!))
            onUnmounted(() => unmounted.push(props.value!))
            return () => call(0, Text, { text: () => `项:${props.value}` })
        }
    })
    const values = ref(Array.from({ length: 1000 }, (_, index) => index))
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, { items: () => values.value, itemKey: () => (value: number) => value, itemContent: () => Item, itemProps: () => (value: number) => ({ value }), state: () => state })
        }
    }))
    app.mount(native.target)
    native.frame()
    const id = lazyNode(native.candidateNodes!).id
    native.materialize(id, [0, 1, 2])
    native.materialize(id, [0, 1, 2, 3])
    assert.equal(native.submissions, 1)
    assert.equal(native.nodes.size, 0)
    assert.deepEqual(mounted, [])
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['项:0', '项:1', '项:2', '项:3'])
    assert.deepEqual(mounted, [0, 1, 2, 3])
    state.scrollToItem(500, 7)
    await nextTick()
    native.frame()
    native.materialize(id, [500, 501])
    assert.deepEqual(mounted, [0, 1, 2, 3])
    assert.throws(() => native.finish('材料化测试失败'), /材料化测试失败/)
    assert.deepEqual(native.textNodes().map(node => node.text), ['项:0', '项:1', '项:2', '项:3'])
    assert.deepEqual(unmounted, [])
    state.scrollToItem(600)
    await nextTick()
    native.frame()
    native.materialize(id, [600, 601])
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['项:600', '项:601'])
    app.unmount()
})

test('Lazy 活动范围缩小不淘汰可见项，离屏逻辑缓存有限且恢复 key 局部状态', async () => {
    const native = recordingNative(false)
    const state = createLazyState()
    const setups = new Map<number, number>()
    const retired: number[] = []
    const Item = defineArrangable({
        props: { value: Number }, setup(props, { call }) {
            const identity = props.value!
            setups.set(identity, (setups.get(identity) ?? 0) + 1)
            onUnmounted(() => retired.push(identity))
            return () => call(0, Text, { text: () => String(props.value) })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, { items: () => Array.from({ length: 200 }, (_, index) => index), itemContent: () => Item, itemProps: () => (value: number) => ({ value }), state: () => state })
        }
    }))
    app.mount(native.target)
    native.frame()
    const id = lazyNode(native.candidateNodes!).id
    native.materialize(id, Array.from({ length: 80 }, (_, index) => index))
    native.finish()
    const select = async (indices: number[]) => {
        state.scrollToItem(indices[0])
        await nextTick()
        native.frame()
        native.materialize(id, indices)
        native.finish()
    }
    await select([0, 1])
    assert.deepEqual(native.textNodes().map(node => node.text), ['0', '1'])
    assert.equal(retired.includes(0) || retired.includes(1), false)
    assert.equal(retired.length, 46)
    await select([79])
    assert.equal(setups.get(79), 1)
    await select([2])
    assert.equal(setups.get(2), 2)
    assert.ok(native.nodes.size < 12)
    app.unmount()
})

test('Lazy state 参数验证与暂停前的请求保留正式单位边界', () => {
    assert.throws(() => createLazyState({ firstVisibleItemIndex: -1 }), RangeError)
    assert.throws(() => createLazyState({ firstVisibleItemScrollOffsetPx: Infinity }), RangeError)
    const state = createLazyState({ firstVisibleItemIndex: 20, firstVisibleItemScrollOffsetPx: 3 })
    assert.equal(state.firstVisibleItemIndex, 20)
    assert.equal(state.firstVisibleItemScrollOffsetPx, 3)
    assert.throws(() => state.scrollToItem(1.5), RangeError)
    assert.throws(() => state.scrollToItem(2, -1), RangeError)
    assert.throws(() => state.scrollTo(NaN), RangeError)
    state.scrollToItem(100, 9)
    assert.equal(state.valuePx, 0)
})

test('同一材料化候选移出再取回 key 重建原生身份，失败恢复已提交身份', async () => {
    const native = recordingNative(false)
    const state = createLazyState()
    const Item = defineArrangable({
        props: { value: Number }, setup(props, { call }) {
            return () => call(0, Text, { text: () => String(props.value) })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, { items: () => [0, 1, 2], itemContent: () => Item, itemProps: () => (value: number) => ({ value }), state: () => state })
        }
    }))
    app.mount(native.target)
    native.frame()
    const id = lazyNode(native.candidateNodes!).id
    native.materialize(id, [0])
    native.finish()
    const oldId = native.textNodes()[0].id
    state.scrollToItem(1)
    await nextTick()
    native.frame()
    native.materialize(id, [1])
    native.materialize(id, [0])
    assert.throws(() => native.finish('失败重挂'), /失败重挂/)
    assert.equal(native.textNodes()[0].id, oldId)
    state.scrollToItem(2)
    await nextTick()
    native.frame()
    native.materialize(id, [2])
    native.materialize(id, [0])
    native.finish()
    assert.deepEqual(native.textNodes().map(node => node.text), ['0'])
    assert.notEqual(native.textNodes()[0].id, oldId)
    app.unmount()
})

test('Lazy 数据重排在测量前迁移活动 key，保留原生身份且失败恢复已发布顺序', async () => {
    const native = recordingNative(false)
    const state = createLazyState()
    const values = ref([0, 1, 2])
    const Item = defineArrangable({
        props: { value: Number }, setup(props, { call }) {
            return () => call(0, Text, { text: () => `稳定:${props.value}` })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyColumn, { items: () => values.value, itemKey: () => (value: number) => value, itemContent: () => Item, itemProps: () => (value: number) => ({ value }), state: () => state })
        }
    }))
    app.mount(native.target)
    native.frame()
    const id = lazyNode(native.candidateNodes!).id
    native.materialize(id, [0, 1])
    native.finish()
    const identities = new Map(native.textNodes().map(node => [node.text, node.id]))
    const candidateIdentity = (text: string) => [...native.candidateNodes!.values()].find(node => (node.inputs.get('modifier') as Modifier | undefined)?.elements.some(element => element.type === 'text' && element.value.text === text))?.id
    values.value = [-1, 0, 1, 2]
    await nextTick()
    native.frame()
    assert.deepEqual((lazyNode(native.candidateNodes!).inputs.get('measurePolicy') as { indices: number[] }).indices, [1, 2])
    for (const [text, identity] of identities) assert.equal(candidateIdentity(text), identity)
    native.materialize(id, [0, 1, 2])
    native.finish()
    const published = native.textNodes()
    values.value = [...values.value].reverse()
    await nextTick()
    native.frame()
    assert.deepEqual((lazyNode(native.candidateNodes!).inputs.get('measurePolicy') as { indices: number[] }).indices, [1, 2, 3])
    for (const node of published) assert.equal(candidateIdentity(node.text), node.id)
    native.materialize(id, [0, 1, 2, 3])
    assert.throws(() => native.finish('拒绝重排'), /拒绝重排/)
    assert.deepEqual(native.textNodes(), published)
    app.unmount()
})


test('Lazy 元数据优化保留索引回调、深层依赖与回调替换，缺省类型和 span 完整覆盖集合', async () => {
    const native = recordingNative(false)
    const values = ref([{ id: 1, type: 10 }, { id: 2, type: 20 }])
    const key = ref((item: { id: number }, index: number) => `${item.id}/${index}`)
    const type = ref<((item: { type: number }, index: number) => number) | undefined>((item, index) => item.type + index)
    const span = ref<((item: { id: number }, index: number) => ReturnType<typeof GridItemSpan>) | undefined>((_item, index) => GridItemSpan(index + 1))
    const Item = defineArrangable({ setup(_props, { call }) { return () => call(0, Text, { text: () => '项' }) } })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => call(0, LazyVerticalGrid, { items: () => values.value, itemKey: () => key.value, contentType: () => type.value, span: () => span.value, itemContent: () => Item })
        }
    }))
    app.mount(native.target)
    const metadata = () => {
        native.frame()
        const policy = lazyNode(native.candidateNodes!).inputs.get('measurePolicy') as { keys: string[], contentTypes: string[], spans: number[] }
        const result = { keys: [...policy.keys], contentTypes: [...policy.contentTypes], spans: [...policy.spans] }
        native.finish()
        return result
    }
    assert.deepEqual(metadata(), { keys: ['s:1/0', 's:2/1'], contentTypes: ['n:10', 'n:21'], spans: [1, 2] })
    values.value = [{ id: 0, type: 30 }, ...values.value]
    await nextTick()
    assert.deepEqual(metadata(), { keys: ['s:0/0', 's:1/1', 's:2/2'], contentTypes: ['n:30', 'n:11', 'n:22'], spans: [1, 2, 3] })
    values.value[1].type = 40
    await nextTick()
    assert.deepEqual(metadata().contentTypes, ['n:30', 'n:41', 'n:22'])
    key.value = item => item.id.toString()
    type.value = undefined
    span.value = undefined
    await nextTick()
    assert.deepEqual(metadata(), { keys: ['s:0', 's:1', 's:2'], contentTypes: ['', '', ''], spans: [1, 1, 1] })
    app.unmount()
})
