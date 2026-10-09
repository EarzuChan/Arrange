import { batchUpdates, reactive, shallowRef, type EffectScope } from '@arrange/reactivity'
import { animatedNumberAsRef, tween, type AnimationSpec } from './animation/value.ts'
import { watch } from './runtime/apiWatch.ts'
import type { ScrollState } from './state.ts'
import type { ArrangableInstance } from './runtime/arrangable.ts'

export type LazyItemKey = string | number
export type LazyVisibleItemInfo = Readonly<{ index: number; key: LazyItemKey; offset: number; size: number; span: number }>
export type LazyLayoutInfo = Readonly<{ visibleItemsInfo: readonly LazyVisibleItemInfo[]; totalItemsCount: number; viewportStartOffset: number; viewportEndOffset: number }>
export interface LazyState extends ScrollState {
    firstVisibleItemIndex: number
    firstVisibleItemScrollOffset: number
    layoutInfo: LazyLayoutInfo
    scrollToItem(index: number, scrollOffset?: number): void
    animateScrollToItem(index: number, scrollOffset?: number, animationSpec?: AnimationSpec): Promise<void>
}

interface LazyFeedback extends Partial<ScrollState> {
    firstVisibleItemIndex?: number
    firstVisibleItemScrollOffset?: number
    totalItemsCount?: number
    needsMoreItems?: boolean
    workGeneration?: number
    visibleItemsInfo?: readonly Omit<LazyVisibleItemInfo, 'key'>[]
}

export interface LazyStateOwner {
    readonly instance: ArrangableInstance
    readonly scope: EffectScope
    key(index: number): LazyItemKey
    estimatedOffset(index: number): number
    isSelected?(): boolean
}

interface StateControl {
    owner?: LazyStateOwner
    pendingOwners?: Set<LazyStateOwner>
    readonly request: { version: number; kind: 'item' | 'pixel'; index: number; offset: number; value: number; workVersion: number }
    appliedRequestVersion: number
    publishedValue: number
    cancelAnimation?: () => void
    animationOwner?: LazyStateOwner
    animating: boolean
}
const controls = new WeakMap<LazyState, StateControl>()

function itemPosition(index: number, offset: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > 2147483647) throw new RangeError('Lazy 项索引必须是非负整数且不超过 2147483647')
    if (!Number.isFinite(offset) || offset < 0) throw new RangeError('Lazy 滚动偏移必须是非负有限 PX 数值')
}

export function createLazyState(args: { firstVisibleItemIndex?: number; firstVisibleItemScrollOffset?: number } = {}): LazyState {
    const initialIndex = args.firstVisibleItemIndex ?? 0
    const initialOffset = args.firstVisibleItemScrollOffset ?? 0
    itemPosition(initialIndex, initialOffset)
    const control: StateControl = { request: reactive({ version: initialIndex || initialOffset ? 1 : 0, kind: 'item', index: initialIndex, offset: initialOffset, value: 0, workVersion: 0 }), appliedRequestVersion: 0, publishedValue: 0, animating: false }
    let state: LazyState
    const jump = (index: number, offset: number) => {
        itemPosition(index, offset)
        batchUpdates(() => {
            control.request.kind = 'item'
            control.request.index = index
            control.request.offset = offset
            control.request.version++
        })
    }
    state = reactive({
        value: 0, maxValue: 0, viewportSize: 0, contentSize: 0,
        isScrollInProgress: false, canScrollBackward: false, canScrollForward: false,
        firstVisibleItemIndex: initialIndex, firstVisibleItemScrollOffset: initialOffset,
        layoutInfo: Object.freeze({ visibleItemsInfo: Object.freeze([]) as readonly LazyVisibleItemInfo[], totalItemsCount: 0, viewportStartOffset: 0, viewportEndOffset: 0 }),
        scrollTo(value: number) {
            if (!Number.isFinite(value)) throw new RangeError('滚动位置必须是有限 PX 数值')
            control.cancelAnimation?.()
            batchUpdates(() => {
                state.value = Math.max(0, value)
                control.request.kind = 'pixel'
                control.request.value = state.value
                control.request.version++
            })
        },
        scrollToItem(index: number, offset = 0) {
            control.cancelAnimation?.()
            jump(index, offset)
        },
        animateScrollToItem(index: number, offset = 0, animationSpec: AnimationSpec = tween()) {
            itemPosition(index, offset)
            control.cancelAnimation?.()
            const owner = control.owner
            if (!owner?.scope.active || owner.instance.isDeactivated || owner.instance.isUnmounted) {
                jump(index, offset)
                return Promise.resolve()
            }
            return new Promise<void>(resolve => owner.scope.run(() => {
                const target = shallowRef(state.value)
                const animation = animatedNumberAsRef(target, {
                    animationSpec, finished: () => {
                        cancel()
                        jump(index, offset)
                    }
                })
                const stop = watch(animation, value => { state.value = Math.max(0, value) }, { flush: 'sync' })
                let done = false
                const cancel = () => {
                    if (done) return
                    done = true
                    stop()
                    animation.stop()
                    if (control.cancelAnimation === cancel) {
                        control.animating = false
                        state.isScrollInProgress = false
                        control.cancelAnimation = undefined
                        control.animationOwner = undefined
                    }
                    resolve()
                }
                control.cancelAnimation = cancel
                control.animationOwner = owner
                control.animating = true
                state.isScrollInProgress = true
                const visible = state.layoutInfo.visibleItemsInfo.find(item => item.index === index)
                const destination = visible ? state.value + visible.offset + offset : owner.estimatedOffset(index) + offset
                target.value = Math.max(0, destination)
                if (target.value === state.value) {
                    cancel()
                    jump(index, offset)
                }
            }))
        },
        __arrangeNativeScroll(payload: LazyFeedback) {
            batchUpdates(() => {
                if (payload.needsMoreItems) control.request.workVersion++
                if (payload.value !== undefined) {
                    control.publishedValue = payload.value
                    state.value = payload.value
                }
                if (payload.maxValue !== undefined) state.maxValue = payload.maxValue
                if (payload.viewportSize !== undefined) state.viewportSize = payload.viewportSize
                if (payload.contentSize !== undefined) state.contentSize = payload.contentSize
                if (payload.firstVisibleItemIndex !== undefined) state.firstVisibleItemIndex = payload.firstVisibleItemIndex
                if (payload.firstVisibleItemScrollOffset !== undefined) state.firstVisibleItemScrollOffset = payload.firstVisibleItemScrollOffset
                if (payload.visibleItemsInfo) state.layoutInfo = Object.freeze({
                    visibleItemsInfo: Object.freeze(payload.visibleItemsInfo.map(item => Object.freeze({ ...item, key: control.owner?.key(item.index) ?? item.index }))),
                    totalItemsCount: payload.totalItemsCount ?? state.layoutInfo.totalItemsCount,
                    viewportStartOffset: 0, viewportEndOffset: state.viewportSize,
                })
                state.canScrollBackward = state.value > 0
                state.canScrollForward = state.value < state.maxValue
                state.isScrollInProgress = control.animating || Boolean(payload.isScrollInProgress)
            })
        },
    }) as LazyState
    controls.set(state, control)
    return state
}

export const createLazyListState = createLazyState
export const createLazyGridState = createLazyState

export function lazyStateRequest(state: LazyState): Readonly<{ version: number; kind: 'item' | 'pixel'; index: number; offset: number; value: number; workVersion: number }> {
    const control = controls.get(state)
    if (!control) throw new TypeError('Lazy state 必须通过 createLazyState 创建')
    return control.request
}

export function lazyStatePublishedValue(state: LazyState): number {
    const control = controls.get(state)
    if (!control) throw new TypeError('Lazy state 必须通过 createLazyState 创建')
    return control.publishedValue
}

export function lazyStateAppliedRequestVersion(state: LazyState): number {
    const control = controls.get(state)
    if (!control) throw new TypeError('Lazy state 必须通过 createLazyState 创建')
    return control.appliedRequestVersion
}

export function acknowledgeLazyStateRequest(state: LazyState, version: number): void {
    const control = controls.get(state)
    if (control) control.appliedRequestVersion = Math.max(control.appliedRequestVersion, version)
}

export function attachLazyState(state: LazyState, owner: LazyStateOwner): () => void {
    const control = controls.get(state)
    if (!control) throw new TypeError('Lazy state 必须通过 createLazyState 创建')
    const previous = control.owner
    const session = owner.instance.rearrangeSession
    if (previous && previous.instance.rearrangeSession !== session) throw new Error('一个 LazyState 不能连接不同 App 的 Lazy Layout')
    if (session.preparing && (previous !== owner || control.pendingOwners)) {
        session.preserve(control, () => {
            const previousAnimation = control.cancelAnimation
            const owners = control.pendingOwners = new Set<LazyStateOwner>(previous ? [previous] : [])
            const activeOwners = () => [...owners].filter(candidate => candidate.isSelected?.() !== false && session.isScopeActive(candidate.instance.structure))
            session.beforeApply(() => {
                if (activeOwners().length > 1) throw new Error('一个 LazyState 只能连接一个存活的 Lazy Layout')
            })
            session.onCommit(() => {
                const next = activeOwners()[0]
                if (next !== previous) previousAnimation?.()
                if (control.animationOwner !== next) control.cancelAnimation?.()
                control.owner = next
                control.pendingOwners = undefined
            })
            return () => {
                if (control.cancelAnimation !== previousAnimation) control.cancelAnimation?.()
                control.owner = previous
                control.pendingOwners = undefined
            }
        })
        control.pendingOwners!.add(owner)
    } else if (previous && previous !== owner && previous.isSelected?.() !== false && session.isScopeActive(previous.instance.structure)) {
        throw new Error('一个 LazyState 只能连接一个存活的 Lazy Layout')
    }
    control.owner = owner
    return () => {
        if (control.owner !== owner) return
        control.cancelAnimation?.()
        control.owner = undefined
    }
}

// 停用保留逻辑位置和待消费请求，只结束属于此 Layout 的运行中动画
export function pauseLazyState(state: LazyState, owner: LazyStateOwner): void {
    const control = controls.get(state)
    if (control?.owner === owner) control.cancelAnimation?.()
}
