import { computed, onScopeDispose, shallowRef } from '@arrange/reactivity'
import { defineArrangable, onDeactivated } from '../runtime/index.ts'
import { currentInstance, retainContent } from '../runtime/internal.ts'
import { parameterInputs, parameterObject } from '../runtime/rearrange.ts'
import type { ArrangableDefinition, ArrangableProps, PropType } from '../runtime/index.ts'
import { isArrangableDefinition } from '../runtime/apiDefineArrangable.ts'
import { acknowledgeLazyStateRequest, attachLazyState, createLazyState, lazyStateAppliedRequestVersion, lazyStateRequest, pauseLazyState, type LazyItemKey, type LazyState, type LazyStateOwner } from '../lazy.ts'
import { LazyMeasurePolicy, BoxMeasurePolicy, ColumnMeasurePolicy, RowMeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import { GridCells, type GridCellsValue, type GridItemSpanValue, type Padding, PaddingValues, type HorizontalAlignment, type VerticalAlignment } from '../primitives.ts'
import type { HorizontalArrangementProp, VerticalArrangementProp } from '../native.ts'
import { Layout } from './Layout.ts'
import type { LayoutContentProvider } from '../layoutContent.ts'

const emptyPadding = PaddingValues({})
const defaultCells = GridCells.Fixed(1)
function identity(value: unknown, name: string): string {
    if (typeof value === 'string') return `s:${value}`
    if (typeof value === 'number' && Number.isFinite(value)) return `n:${Object.is(value, -0) ? 0 : value}`
    throw new TypeError(`${name} 必须是字符串或有限数值`)
}

const LazyItem = defineArrangable({
    name: 'LazyItem',
    props: { item: null, index: { type: Number, required: true }, definition: { type: Object as PropType<ArrangableDefinition>, required: true }, itemProps: Function as PropType<(item: any, index: number) => Record<string, unknown>>, horizontal: Boolean, grid: Boolean },
    slotNames: [],
    setup(props, { call }) {
        return () => call(0, Layout, { measurePolicy: () => props.grid ? BoxMeasurePolicy() : props.horizontal ? RowMeasurePolicy() : ColumnMeasurePolicy() }, {
            default: () => call(0, props.definition, parameterInputs(parameterObject(0, () => props.itemProps?.(props.item, props.index) ?? {}))),
        })
    },
})

function lazyDefinition(name: string, horizontal: boolean, grid: boolean) {
    return defineArrangable({
        name,
        props: {
            modifier: { type: Modifier, default: M },
            items: { type: Array as PropType<readonly any[]>, required: true },
            itemKey: Function as PropType<(item: any, index: number) => LazyItemKey>,
            itemContent: { type: Object as PropType<ArrangableDefinition>, required: true, validator: isArrangableDefinition },
            itemProps: Function as PropType<(item: any, index: number) => Record<string, unknown>>,
            contentType: Function as PropType<(item: any, index: number) => string | number | null>,
            span: Function as PropType<(item: any, index: number) => GridItemSpanValue>,
            state: Object as PropType<LazyState>,
            cells: { type: Object as PropType<GridCellsValue>, default: defaultCells },
            horizontalArrangement: [String, Object] as PropType<HorizontalArrangementProp>,
            verticalArrangement: [String, Object] as PropType<VerticalArrangementProp>,
            horizontalAlignment: String as PropType<HorizontalAlignment>,
            verticalAlignment: String as PropType<VerticalAlignment>,
            contentPadding: { type: Object as PropType<Padding>, default: emptyPadding },
            userScrollEnabled: { type: Boolean, default: true },
        },
        slotNames: [],
        setup(props, { call }) {
            const owner = currentInstance!
            const defaultState = createLazyState()
            type StateAttachment = { readonly state: LazyState; readonly owner: LazyStateOwner; readonly detach: () => void }
            let attachments = new Map<LazyState, StateAttachment>()
            let selected: StateAttachment | undefined
            let requestState: LazyState | undefined
            let sourceRequestVersion = -1
            let nativeRequestVersion = 0
            const stateBinding = {}
            const readState = () => {
                const state = props.state ?? defaultState
                const session = owner.rearrangeSession
                if (session.preparing) session.preserve(stateBinding, () => {
                    const previousAttachments = new Map(attachments)
                    const previousSelected = selected
                    const previousRequestState = requestState
                    const previousSourceRequestVersion = sourceRequestVersion
                    const previousNativeRequestVersion = nativeRequestVersion
                    session.onCommitCleanup(() => {
                        if (selected && requestState === selected.state) acknowledgeLazyStateRequest(selected.state, sourceRequestVersion)
                        for (const attachment of attachments.values()) if (attachment !== selected) attachment.detach()
                        attachments = selected ? new Map([[selected.state, selected]]) : new Map()
                    })
                    return () => {
                        attachments = previousAttachments
                        selected = previousSelected
                        requestState = previousRequestState
                        sourceRequestVersion = previousSourceRequestVersion
                        nativeRequestVersion = previousNativeRequestVersion
                    }
                })
                let attachment = attachments.get(state)
                if (!attachment) {
                    const stateOwner: LazyStateOwner = {
                        instance: owner, scope: owner.scope,
                        isSelected: () => selected?.state === state,
                        key: index => props.itemKey?.(props.items[index], index) ?? index,
                        estimatedOffset: index => {
                            const first = state.layoutInfo.visibleItemsInfo[0]
                            const estimate = first?.size || 48
                            const cells = grid && props.cells.type === 'Fixed' ? props.cells.count : 1
                            return Math.max(0, state.value + (Math.floor(index / cells) - Math.floor(state.firstVisibleItemIndex / cells)) * estimate - state.firstVisibleItemScrollOffset)
                        },
                    }
                    attachment = { state, owner: stateOwner, detach: attachLazyState(state, stateOwner) }
                    attachments.set(state, attachment)
                } else {
                    // KeepAlive 恢复时此 state 可能曾交给另一份已停用的 Layout
                    attachLazyState(state, attachment.owner)
                }
                selected = attachment
                return state
            }
            onDeactivated(() => { if (selected) pauseLazyState(selected.state, selected.owner) })
            onScopeDispose(() => {
                for (const attachment of attachments.values()) attachment.detach()
                attachments.clear()
                selected = undefined
            })
            const selectedKeys = shallowRef<readonly string[]>([])
            let version = 0
            const data = computed(() => {
                if (!Array.isArray(props.items) || props.items.length > 1000000) throw new TypeError('Lazy items 必须是最多 1000000 项的数组')
                const keys = props.items.map((item, index) => identity(props.itemKey?.(item, index) ?? index, 'Lazy key'))
                const keyToIndex = new Map(keys.map((key, index) => [key, index]))
                if (keyToIndex.size !== keys.length) throw new TypeError('Lazy key 不能重复')
                const contentTypes = props.items.map((item, index) => {
                    const type = props.contentType?.(item, index)
                    return type == null ? '' : identity(type, 'Lazy contentType')
                })
                const spans = props.items.map((item, index) => {
                    const span = props.span?.(item, index)
                    return !span ? 1 : span.type === 'GridItemSpan.MaxLineSpan' ? -1 : span.count
                })
                return { keys, keyToIndex, contentTypes, spans, version: ++version }
            })
            // 数据重排先按稳定 key 迁移活动范围，避免测量前退挂仍被焦点或捕获持有的项
            const indices = computed(() => Object.freeze(selectedKeys.value.map(key => data.value.keyToIndex.get(key)).filter((index): index is number => index !== undefined).sort((a, b) => a - b)))
            const provider: LayoutContentProvider = {
                prepare(next) {
                    owner.rearrangeSession.preserve(provider, () => {
                        const previous = selectedKeys.value
                        return () => { selectedKeys.value = previous }
                    })
                    selectedKeys.value = Object.freeze(next.map(index => data.value.keys[index]))
                },
                render() {
                    const dataset = data.value
                    const selected = indices.value
                    // 缓存上限包含本帧活动范围，另保留最多 32 个离屏逻辑项
                    for (const index of selected) retainContent(0, dataset.keys[index], () => call(0, LazyItem, {
                        item: () => props.items[index], index: () => index, definition: () => props.itemContent, itemProps: () => props.itemProps,
                        horizontal: () => horizontal, grid: () => grid,
                    }), selected.length + 32)
                },
            }
            return () => call(0, Layout, {
                modifier: () => {
                    const state = readState()
                    return horizontal ? props.modifier.horizontalScroll(state, { enabled: props.userScrollEnabled }) : props.modifier.verticalScroll(state, { enabled: props.userScrollEnabled })
                },
                contentProvider: () => provider,
                measurePolicy: () => {
                    const dataset = data.value
                    const state = readState()
                    const request = lazyStateRequest(state)
                    if (requestState !== state || sourceRequestVersion !== request.version) {
                        if (request.version > lazyStateAppliedRequestVersion(state)) nativeRequestVersion++
                        requestState = state
                        sourceRequestVersion = request.version
                    }
                    return LazyMeasurePolicy({
                        horizontal, grid, cells: props.cells, horizontalArrangement: props.horizontalArrangement, verticalArrangement: props.verticalArrangement,
                        itemAlignment: horizontal ? props.verticalAlignment : props.horizontalAlignment, contentPadding: props.contentPadding,
                        keys: dataset.keys, contentTypes: dataset.contentTypes, spans: dataset.spans, indices: indices.value, pinnedIndices: [], version: dataset.version,
                        workVersion: request.workVersion, requestVersion: nativeRequestVersion, requestedIndex: request.index, requestedOffset: request.offset,
                    })
                },
            })
        },
    })
}

export const LazyColumn = lazyDefinition('LazyColumn', false, false)
export const LazyRow = lazyDefinition('LazyRow', true, false)
export const LazyVerticalGrid = lazyDefinition('LazyVerticalGrid', false, true)
export const LazyHorizontalGrid = lazyDefinition('LazyHorizontalGrid', true, true)
export type LazyColumnProps = ArrangableProps<typeof LazyColumn>
export type LazyRowProps = ArrangableProps<typeof LazyRow>
export type LazyVerticalGridProps = ArrangableProps<typeof LazyVerticalGrid>
export type LazyHorizontalGridProps = ArrangableProps<typeof LazyHorizontalGrid>
