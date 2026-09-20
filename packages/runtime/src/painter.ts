import { getCurrentScope, onScopeDispose, shallowRef } from '@arrange/vue-reactivity'
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
export type PainterSnapshot = NativeBindingHandle & Readonly<{ contentVersion: number; intrinsicSize?: PainterSize }>
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
    if (!native?.acquirePainter || !native.releasePainter) throw new Error('当前宿主未提供 Painter 资源服务')
    const location = typeof resource === 'string' ? resource : resource?.path
    if (typeof location !== 'string' || !location) throw new TypeError('Painter 资源地址必须是非空字符串')

    const state = shallowRef<{ status: PainterStatus; contentVersion: number; intrinsicSize?: PainterSize; error?: string }>({ status: 'loading', contentVersion: 0 })
    const handle = native.acquirePainter(location, completion => {
        if (state.value.status === 'disposed' || completion.contentVersion <= state.value.contentVersion) return
        state.value = { status: completion.error ? 'failed' : 'ready', contentVersion: completion.contentVersion, intrinsicSize: completion.width === undefined || completion.height === undefined ? undefined : Object.freeze({ width: completion.width, height: completion.height }), error: completion.error }
    })
    const result: Painter = Object.freeze({
        get intrinsicSize() { return state.value.intrinsicSize },
        get contentVersion() { return state.value.contentVersion },
        get status() { return state.value.status },
        get error() { return state.value.error },
        dispose() {
            if (state.value.status === 'disposed') return
            state.value = { status: 'disposed', contentVersion: state.value.contentVersion + 1 }
            native.releasePainter!(handle)
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
