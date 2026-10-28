import { reactive, batchUpdates } from "@arrange/reactivity"

// 原生滚动快照，数值为逻辑 PX
export type ScrollSnapshot = Partial<{ value: number; maxValue: number; viewportSize: number; contentSize: number; isScrollInProgress: boolean }>

export interface ScrollState {
    readonly valuePx: number
    readonly maxValuePx: number
    readonly viewportSizePx: number
    readonly contentSizePx: number
    readonly isScrollInProgress: boolean
    readonly canScrollBackward: boolean
    readonly canScrollForward: boolean
    scrollTo(valuePx: number): void
}

// 滚动修饰降解的内部通道：原生回写入口，引用稳定
export interface ScrollStateInternal {
    readonly native: (payload: ScrollSnapshot) => void
}

const scrollInternals = new WeakMap<object, ScrollStateInternal>()

export function scrollStateInternal(state: ScrollState): ScrollStateInternal {
    const internal = scrollInternals.get(state)
    if (!internal) throw new TypeError('滚动修饰需要 createScrollState() 或 createLazyState() 创建的状态')
    return internal
}

export function registerScrollState(state: ScrollState, internal: ScrollStateInternal): void {
    scrollInternals.set(state, Object.freeze(internal))
}

export function createScrollState(args: { initialPx?: number } = {}): ScrollState {
    const store = reactive({ value: args.initialPx ?? 0, maxValue: 0, viewportSize: 0, contentSize: 0, isScrollInProgress: false })
    const apply = (snapshot: ScrollSnapshot) => batchUpdates(() => {
        if (typeof snapshot.value === "number") store.value = snapshot.value
        if (typeof snapshot.maxValue === "number") store.maxValue = snapshot.maxValue
        if (typeof snapshot.viewportSize === "number") store.viewportSize = snapshot.viewportSize
        if (typeof snapshot.contentSize === "number") store.contentSize = snapshot.contentSize
        store.isScrollInProgress = Boolean(snapshot.isScrollInProgress ?? false)
    })
    const state: ScrollState = Object.freeze({
        get valuePx() { return store.value },
        get maxValuePx() { return store.maxValue },
        get viewportSizePx() { return store.viewportSize },
        get contentSizePx() { return store.contentSize },
        get isScrollInProgress() { return store.isScrollInProgress },
        get canScrollBackward() { return store.value > 0 },
        get canScrollForward() { return store.value < store.maxValue },
        scrollTo(valuePx: number) { apply({ value: valuePx }) },
    })
    registerScrollState(state, { native: apply })
    return state
}
