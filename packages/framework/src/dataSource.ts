// 原生数据源：UI 帧开始时把最新数据写进固定的 Float32Array 并推进版本，读取不经响应式
export type DataSourceKind = 'meter' | 'waveform' | 'spectrum'

export interface DataSource {
    readonly kind: DataSourceKind
    readonly name: string
    // 每次交付新数据加一；同一帧内多次读取得到同一数组内容
    readonly version: number
    // 返回只读视图，内容在下次交付时原地更新；需要保留请自行复制
    read(): Float32Array
}

export class DataSourceState {
    version = 0
    private readonly listeners = new Set<() => void>()

    constructor(readonly kind: DataSourceKind, readonly name: string, public array: Float32Array) { }

    // 交付后通知读取过它的 Canvas；监听者可在回调中增删
    publish(): void {
        this.version++
        for (const listener of [...this.listeners]) if (this.listeners.has(listener)) listener()
    }

    watch(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }
}

let reads: Set<DataSourceState> | undefined

// 绘制录制期间登记读过的数据源，供 auto 失效订阅
export function collectSourceReads<T>(work: () => T): readonly [T, ReadonlySet<DataSourceState>] {
    const previous = reads
    const current = reads = new Set()
    try {
        return [work(), current] as const
    } finally {
        reads = previous
    }
}

export function noteSourceRead(state: DataSourceState): void { reads?.add(state) }

const viewStates = new WeakMap<object, DataSourceState>()

// 由只读视图取回数据源状态；不是数据源时返回 undefined
export function sourceStateOf(value: unknown): DataSourceState | undefined {
    return typeof value === 'object' && value !== null ? viewStates.get(value) : undefined
}

export function sourceView(state: DataSourceState, size?: number): DataSource {
    const view: DataSource = Object.freeze({
        kind: state.kind,
        name: state.name,
        get version() { return state.version },
        read() {
            noteSourceRead(state)
            const array = state.array
            return size === undefined || array.length <= size ? array : array.subarray(array.length - size)
        },
    })
    viewStates.set(view, state)
    return view
}
