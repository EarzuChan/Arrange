import { reactive } from "@arrange/vue-reactivity"

type ScrollSnapshot = Partial<Pick<ScrollState, "value" | "maxValue" | "viewportSize" | "contentSize" | "isScrollInProgress">>

export type ScrollState = {
    value: number
    maxValue: number
    viewportSize: number
    contentSize: number
    isScrollInProgress: boolean
    canScrollBackward: boolean
    canScrollForward: boolean
    scrollTo: (value: number) => void
    __arrangeNativeScroll: (payload: ScrollSnapshot) => void
}

export function createScrollState(args: { initial?: number } = {}): ScrollState {
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
            applyScrollSnapshot(state, { value })
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
