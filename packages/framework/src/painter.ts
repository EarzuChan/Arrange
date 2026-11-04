import { getCurrentScope, onScopeDispose, shallowRef } from '@arrange/reactivity'
import type { NativeBindingHandle, NativeTransactionTarget, ResourceRef } from './native.ts'

export type PainterSize = Readonly<{ width: number; height: number }>
export type PainterStatus = 'loading' | 'ready' | 'failed' | 'disposed'
export interface Painter {
    readonly intrinsicSize: PainterSize | undefined
    readonly contentVersion: number
    readonly status: PainterStatus
    readonly error: string | undefined
    dispose(): void
}

export type PainterCompletion = Readonly<{ contentVersion: number; width?: number; height?: number; error?: string }>
export type PainterSnapshot = NativeBindingHandle & Readonly<{ contentVersion: number; intrinsicSize?: PainterSize; frames?: number; frame?: number; horizontal?: boolean }>
const painters = new WeakMap<Painter, () => PainterSnapshot>()

export function isPainter(value: unknown): value is Painter {
    return typeof value === 'object' && value !== null && painters.has(value as Painter)
}

export function painterSnapshot(value: Painter): PainterSnapshot {
    const snapshot = painters.get(value)
    if (!snapshot) throw new TypeError('需要资源获取层创建的 Painter')
    return snapshot()
}

// 获取层拥有资源请求；FA 只消费其状态、尺寸和内容版本
export function painter(resource: ResourceRef): Painter {
    const native: NativeTransactionTarget | undefined = globalThis.__ARRANGE_NATIVE__
    if (!native) throw new Error('Painter 需要原生运行时')
    const location = typeof resource === 'string' ? resource : resource?.path
    if (typeof location !== 'string' || !location) throw new TypeError('Painter 资源地址必须是非空字符串')

    const state = shallowRef<{ status: PainterStatus; contentVersion: number; intrinsicSize?: PainterSize; error?: string }>({ status: 'loading', contentVersion: 0 })
    const complete = (completion: PainterCompletion) => {
        if (state.value.status === 'disposed' || completion.contentVersion <= state.value.contentVersion) return
        state.value = { status: completion.error ? 'failed' : 'ready', contentVersion: completion.contentVersion, intrinsicSize: completion.width === undefined || completion.height === undefined ? undefined : Object.freeze({ width: completion.width, height: completion.height }), error: completion.error }
    }
    const { ready, ...handle } = native.acquirePainter(location, complete)
    if (ready) complete(ready)
    const result: Painter = Object.freeze({
        get intrinsicSize() { return state.value.intrinsicSize },
        get contentVersion() { return state.value.contentVersion },
        get status() { return state.value.status },
        get error() { return state.value.error },
        dispose() {
            if (state.value.status === 'disposed') return
            state.value = { status: 'disposed', contentVersion: state.value.contentVersion + 1 }
            native.releasePainter(handle)
        },
    })
    painters.set(result, () => {
        const current = state.value
        if (current.status === 'failed') throw new Error(`Painter 加载失败：${current.error}`)
        return current.status === 'disposed' ? { identity: 0n, generation: 0n, contentVersion: current.contentVersion } : { ...handle, contentVersion: current.contentVersion, intrinsicSize: current.intrinsicSize }
    })
    if (getCurrentScope()) onScopeDispose(result.dispose)
    return result
}

export type FilmstripOrientation = 'vertical' | 'horizontal'
// filmstrip：一张图按帧数等分；frame 与 at 返回可用于一切 painter 位置的单帧视图
export interface Filmstrip {
    readonly painter: Painter
    readonly frames: number
    readonly orientation: FilmstripOrientation
    frame(index: number): Painter
    // 0 到 1 的比例映射到首帧至末帧，四舍五入
    at(fraction: number): Painter
}

export function filmstrip(source: Painter, args: Readonly<{ frames: number; orientation?: FilmstripOrientation }>): Filmstrip {
    if (!isPainter(source)) throw new TypeError('filmstrip 需要资源获取层创建的 Painter')
    const frames = args.frames, orientation = args.orientation ?? 'vertical'
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 4096) throw new RangeError('filmstrip 帧数需要 1 到 4096 的整数')
    if (orientation !== 'vertical' && orientation !== 'horizontal') throw new TypeError('filmstrip 方向只能是 vertical 或 horizontal')
    const horizontal = orientation === 'horizontal'
    const views = new Map<number, Painter>()
    const view = (index: number): Painter => {
        const cached = views.get(index)
        if (cached) return cached
        const result: Painter = Object.freeze({
            get intrinsicSize() {
                const size = source.intrinsicSize
                return size && Object.freeze(horizontal ? { width: size.width / frames, height: size.height } : { width: size.width, height: size.height / frames })
            },
            get contentVersion() { return source.contentVersion },
            get status() { return source.status },
            get error() { return source.error },
            // 视图不拥有资源，释放由原 painter 负责
            dispose() { },
        })
        painters.set(result, () => {
            const base = painterSnapshot(source)
            return { ...base, frames, frame: index, horizontal, intrinsicSize: result.intrinsicSize }
        })
        views.set(index, result)
        return result
    }
    return Object.freeze({
        painter: source,
        frames,
        orientation,
        frame(index: number) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= frames) throw new RangeError(`filmstrip 帧下标需要 0 到 ${frames - 1} 的整数`)
            return view(index)
        },
        at(fraction: number) {
            if (!Number.isFinite(fraction)) throw new RangeError('filmstrip 比例需要有限数值')
            return view(Math.round(Math.min(1, Math.max(0, fraction)) * (frames - 1)))
        },
    })
}

// 像素缓冲：JS 填写非预乘 ARGB 的 data，commit 时整块复制进原生并增加版本；它本身就是 painter
export interface PixelBuffer extends Painter {
    readonly width: number
    readonly height: number
    readonly data: Uint32Array
    commit(): void
}

export function createPixelBuffer(width: number, height: number): PixelBuffer {
    const native: NativeTransactionTarget | undefined = globalThis.__ARRANGE_NATIVE__
    if (!native) throw new Error('像素缓冲需要原生运行时')
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024) throw new RangeError('像素缓冲边长需要 1 到 4096 的整数，总像素不超过 4194304')
    const handle = native.createPixelBuffer(width, height)
    const data = new Uint32Array(width * height)
    const size = Object.freeze({ width, height })
    const state = shallowRef<{ disposed: boolean; contentVersion: number }>({ disposed: false, contentVersion: 1 })
    const result: PixelBuffer = Object.freeze({
        width,
        height,
        data,
        get intrinsicSize() { return state.value.disposed ? undefined : size },
        get contentVersion() { return state.value.contentVersion },
        get status(): PainterStatus { return state.value.disposed ? 'disposed' : 'ready' },
        get error() { return undefined },
        commit() {
            if (state.value.disposed) throw new Error('像素缓冲已释放')
            state.value = { disposed: false, contentVersion: native.commitPixelBuffer(handle, data) }
        },
        dispose() {
            if (state.value.disposed) return
            state.value = { disposed: true, contentVersion: state.value.contentVersion + 1 }
            native.releasePainter(handle)
        },
    })
    painters.set(result, () => {
        const current = state.value
        return current.disposed ? { identity: 0n, generation: 0n, contentVersion: current.contentVersion } : { ...handle, contentVersion: current.contentVersion, intrinsicSize: size }
    })
    if (getCurrentScope()) onScopeDispose(result.dispose)
    return result
}
