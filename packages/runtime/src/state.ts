import {reactive} from "@arrange/vue-reactivity"

export type InteractionState = {hovered: boolean; pressed: boolean; focused: boolean; enabled: boolean}
type ScrollSnapshot = Partial<Pick<ScrollState, "value" | "maxValue" | "viewportSize" | "contentSize" | "isScrollInProgress">>
export type LazyVisibleItemInfo = {
    index: number
    key?: string | number
    offset: number
    size: number
}

export type ScrollState = {
    value: number
    maxValue: number
    viewportSize: number
    contentSize: number
    isScrollInProgress: boolean
    canScrollBackward: boolean
    canScrollForward: boolean
    scrollTo: (value: number) => void
    animateScrollTo: (value: number) => void
    __arrangeNativeScroll: (payload: ScrollSnapshot) => void
}

export function rememberInteractionState(): InteractionState {
    return reactive({hovered: false, pressed: false, focused: false, enabled: true})
}

// FocusRequester / useFocusManager 将来会在 JS 请求 focus、native focus session、IME/caret、pipeline 与测试闭环齐全后再正规添加回来；当前故意不公开孤儿 API。

export function rememberScrollState(args: {initial?: number} = {}): ScrollState {
    let state: ScrollState
    state = reactive({
        value: args.initial ?? 0,
        maxValue: 0,
        viewportSize: 0,
        contentSize: 0,
        isScrollInProgress: false,
        canScrollBackward: false,
        canScrollForward: false,
        scrollTo(value: number) {
            applyScrollSnapshot(state, {value})
        },
        animateScrollTo(value: number) {
            this.scrollTo(value)
        },
        __arrangeNativeScroll(payload: ScrollSnapshot) {
            applyScrollSnapshot(state, payload)
        },
    })
    applyScrollSnapshot(state, state)
    return state
}

function applyScrollSnapshot(state: ScrollState, snapshot: ScrollSnapshot = {}): ScrollState {
    if (typeof snapshot.value === "number") state.value = snapshot.value
    if (typeof snapshot.maxValue === "number") state.maxValue = snapshot.maxValue
    if (typeof snapshot.viewportSize === "number") state.viewportSize = snapshot.viewportSize
    if (typeof snapshot.contentSize === "number") state.contentSize = snapshot.contentSize
    state.canScrollBackward = state.value > 0
    state.canScrollForward = state.value < state.maxValue
    state.isScrollInProgress = Boolean(snapshot.isScrollInProgress ?? false)
    return state
}

export function rememberLazyListState(args: {initialFirstVisibleItemIndex?: number; initialFirstVisibleItemScrollOffset?: number} = {}) {
    return {
        firstVisibleItemIndex: args.initialFirstVisibleItemIndex ?? 0,
        firstVisibleItemScrollOffset: args.initialFirstVisibleItemScrollOffset ?? 0,
        visibleItemsInfo: [] as LazyVisibleItemInfo[],
        totalItemsCount: 0,
        viewportStartOffset: 0,
        viewportEndOffset: 0,
        isScrollInProgress: false,
        canScrollBackward: false,
        canScrollForward: false,
        scrollToItem(index: number, scrollOffset = 0) {
            this.firstVisibleItemIndex = index
            this.firstVisibleItemScrollOffset = scrollOffset
        },
        animateScrollToItem(index: number, scrollOffset = 0) {
            this.scrollToItem(index, scrollOffset)
        }
    }
}

export function rememberLazyGridState(args: {initialFirstVisibleItemIndex?: number; initialFirstVisibleItemScrollOffset?: number} = {}) {
    return rememberLazyListState(args)
}

export function rememberInputState(args: {value?: string} = {}) {
    return {value: args.value ?? "", selectionStart: 0, selectionEnd: 0}
}

export function rememberCanvasInvalidationHandle() {
    return {
        invalidated: false,
        invalidate() {
            this.invalidated = true
        },
    }
}

/** @deprecated use rememberCanvasInvalidationHandle. */
export const rememberCanvasController = rememberCanvasInvalidationHandle

export function useParameter(id: string) {
    let value = 0
    return {
        id,
        get value() { return value },
        get normalizedValue() { return value },
        set(next: number) { value = next },
        setNormalized(next: number) { value = next },
        gesture() {
            return {
                begin() {},
                set(next: number) { value = next },
                end() {},
            }
        }
    }
}

export function useHost(): Record<string, never> { return {} }
export function useTransport(): {playing: boolean; bpm: number | null; positionPpq: number | null} { return {playing: false, bpm: null, positionPpq: null} }

