import { batchUpdates, computed, getCurrentScope, onScopeDispose, shallowRef, type ComputedRef, type ShallowRef } from '@arrange/reactivity'
import { currentInstance } from './runtime/arrangable.ts'
import type { EditableValue } from './valueDrag.ts'
import type { NativeHostFormat, NativeHostInfo, NativeInterop, NativeInteropDriver, NativeInteropValue, NativeParameterDescriptor, NativeTransactionTarget, NativeTransport } from './native.ts'

export type InteropValue = NativeInteropValue
export type HostFormat = NativeHostFormat

export type ParameterDescriptor = Readonly<Omit<NativeParameterDescriptor, 'value' | 'index'>>

export interface ParameterGesture {
    readonly active: boolean
    begin(): void
    set(value: number): void
    setNormalized(normalized: number): void
    end(): void
}

// 像 ref 一样以 value 读写并被依赖追踪；不是 ref 本身，模板中写 gain.value
export interface Parameter {
    readonly descriptor: ParameterDescriptor
    value: number
    normalized: number
    readonly text: string
    gesture(): ParameterGesture
    reset(): void
    textFor(normalized: number): string
    parseText(text: string): number | null
    // 读写标准化值的可编辑值，begin / set / end 对应本参数 gesture；默认值与离散步长取自参数描述
    editable(): EditableValue
    // 在当前指针位置弹出宿主的参数菜单；宿主不提供时返回 false
    showHostMenu(): boolean
}

export type HostInfo = NativeHostInfo
export type Transport = NativeTransport

interface ParameterState {
    readonly index: number
    readonly descriptor: ParameterDescriptor
    readonly normalized: ShallowRef<number>
    readonly plain: ComputedRef<number>
    readonly text: ComputedRef<string>
    gesture: ParameterGesture | undefined
    handle?: Parameter
}

interface StreamState<T> {
    readonly data: ShallowRef<T>
}

class InteropClient {
    private readonly parametersById = new Map<string, ParameterState>()
    private readonly parametersByIndex: ParameterState[] = []
    private hostState: ShallowRef<HostInfo> | undefined
    private transportState: ShallowRef<Transport> | undefined
    private readonly meters = new Map<string, StreamState<number>>()
    private readonly waveforms = new Map<string, StreamState<Float32Array>>()
    private readonly spectra = new Map<string, StreamState<Float32Array>>()
    private readonly listeners = new Map<string, Set<(value: InteropValue) => void>>()
    private readonly calls = new Map<number, { resolve(value: InteropValue): void; reject(error: Error): void }>()

    constructor(readonly api: NativeInterop) {
        for (const descriptor of api.parameters()) {
            const index = descriptor.index
            const normalized = shallowRef(descriptor.value)
            const info: ParameterDescriptor = Object.freeze({ id: descriptor.id, name: descriptor.name, label: descriptor.label, defaultNormalized: descriptor.defaultNormalized, steps: descriptor.steps, discrete: descriptor.discrete, boolean: descriptor.boolean, minimum: descriptor.minimum, maximum: descriptor.maximum })
            const state: ParameterState = { index, descriptor: info, normalized, plain: computed(() => api.toPlain(index, normalized.value)), text: computed(() => api.text(index, normalized.value)), gesture: undefined }
            this.parametersById.set(descriptor.id, state)
            this.parametersByIndex[index] = state
        }
        const driver: NativeInteropDriver = {
            parameters: (indices, values) => batchUpdates(() => {
                for (let i = 0; i < indices.length; i++) {
                    const state = this.parametersByIndex[indices[i]]
                    // 本会话 gesture 进行中不被宿主回传覆盖，结束时再对齐
                    if (state && !state.gesture) state.normalized.value = values[i]
                }
            }),
            host: info => { if (this.hostState) this.hostState.value = info },
            transport: state => { if (this.transportState) this.transportState.value = state },
            meter: (name, level) => {
                const state = this.meters.get(name)
                if (state) state.data.value = level
            },
            waveform: (name, samples) => {
                const state = this.waveforms.get(name)
                if (state) state.data.value = samples
            },
            spectrum: (name, values) => {
                const state = this.spectra.get(name)
                if (state) state.data.value = values
            },
            message: (name, value) => { for (const listener of [...this.listeners.get(name) ?? []]) listener(value) },
            reply: (id, ok, value, error) => {
                const call = this.calls.get(id)
                if (!call) return
                this.calls.delete(id)
                if (ok) call.resolve(value)
                else call.reject(new Error(error))
            },
        }
        api.install(driver)
    }

    parameter(id: string): Parameter {
        const state = this.parametersById.get(id)
        if (!state) throw new RangeError(`未登记的参数：${id}`)
        return state.handle ??= this.createParameter(state)
    }

    private createParameter(state: ParameterState): Parameter {
        const { api } = this
        const { index } = state
        const write = (normalized: number) => {
            const next = clampUnit(normalized)
            if (state.gesture) throw new Error(`参数 ${state.descriptor.id} 的 gesture 进行中，请通过 gesture 写入`)
            if (next === state.normalized.value) return
            state.normalized.value = next
            api.set(index, next, true)
        }
        return Object.freeze({
            descriptor: state.descriptor,
            get value() { return state.plain.value },
            set value(value: number) { write(api.toNormalized(index, finite(value, '参数值'))) },
            get normalized() { return state.normalized.value },
            set normalized(value: number) { write(finite(value, '标准化值')) },
            get text() { return state.text.value },
            gesture: () => this.createGesture(state),
            reset: () => write(state.descriptor.defaultNormalized),
            textFor: (normalized: number) => api.text(index, clampUnit(finite(normalized, '标准化值'))),
            parseText: (text: string) => api.parse(index, text),
            editable: () => this.createEditable(state),
            showHostMenu: () => api.hostMenu(index),
        })
    }

    private createEditable(state: ParameterState): EditableValue {
        const { descriptor } = state
        // 在 setup 中取得时随作用域销毁结束未完成的 gesture
        const gesture = this.createGesture(state)
        const handle = this.parameter(descriptor.id)
        return Object.freeze({
            get value() { return state.normalized.value },
            defaultValue: descriptor.defaultNormalized,
            step: descriptor.discrete && descriptor.steps > 1 ? 1 / (descriptor.steps - 1) : undefined,
            begin: () => gesture.begin(),
            set: (value: number) => {
                if (gesture.active) gesture.setNormalized(value)
                else handle.normalized = value
            },
            end: () => gesture.end(),
        })
    }

    private createGesture(state: ParameterState): ParameterGesture {
        const { api } = this
        const { index } = state
        let active = false
        const gesture: ParameterGesture = {
            get active() { return active },
            begin() {
                if (active) return
                if (state.gesture) throw new Error(`参数 ${state.descriptor.id} 已有进行中的 gesture`)
                api.gesture(index, 'begin')
                state.gesture = gesture
                active = true
            },
            set(value: number) { gesture.setNormalized(api.toNormalized(index, finite(value, '参数值'))) },
            setNormalized(normalized: number) {
                if (!active) throw new Error('gesture 尚未开始')
                const next = clampUnit(finite(normalized, '标准化值'))
                if (next === state.normalized.value) return
                state.normalized.value = next
                api.set(index, next, false)
            },
            end() {
                if (!active) return
                active = false
                state.gesture = undefined
                api.gesture(index, 'end')
                state.normalized.value = api.parameterValue(index)
            },
        }
        if (getCurrentScope()) onScopeDispose(() => gesture.end())
        return gesture
    }

    host(): HostInfo {
        const state = this.hostState ??= shallowRef(this.api.host())
        return readonlyView(state, ['name', 'format', 'sampleRate', 'blockSize'])
    }

    transport(): Transport {
        const state = this.transportState ??= shallowRef(this.api.transport())
        this.subscribe('transport', '')
        return readonlyView(state, ['playing', 'recording', 'looping', 'bpm', 'timeSignature', 'positionPpq', 'positionSeconds'])
    }

    meter(name: string): ComputedRef<number> {
        this.subscribe('meter', name)
        const state = getOrCreate(this.meters, name, () => ({ data: shallowRef(0) }))
        return computed(() => state.data.value)
    }

    waveform(name: string, size: number): ComputedRef<Float32Array> {
        this.subscribe('waveform', name, size)
        const state = getOrCreate(this.waveforms, name, () => ({ data: shallowRef(new Float32Array(size)) }))
        // 多处订阅同名波形时原生按最大长度交付，各自取最近 size 个样本
        return computed(() => {
            const samples = state.data.value
            return samples.length <= size ? samples : samples.subarray(samples.length - size)
        })
    }

    spectrum(name: string): ComputedRef<Float32Array> {
        this.subscribe('spectrum', name)
        const state = getOrCreate(this.spectra, name, () => ({ data: shallowRef(new Float32Array(0)) }))
        return computed(() => state.data.value)
    }

    onEvent(name: string, handler: (value: InteropValue) => void): () => void {
        const listeners = getOrCreate(this.listeners, name, () => new Set())
        listeners.add(handler)
        const stop = () => { listeners.delete(handler) }
        if (getCurrentScope()) onScopeDispose(stop)
        return stop
    }

    invoke<T>(name: string, args: InteropValue): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const id = this.api.invoke(name, args)
            this.calls.set(id, { resolve: value => resolve(value as T), reject })
        })
    }

    private subscribe(kind: 'meter' | 'waveform' | 'spectrum' | 'transport', name: string, size?: number): void {
        const id = this.api.subscribe(kind, name, size)
        if (getCurrentScope()) onScopeDispose(() => this.api.unsubscribe(id))
    }
}

const clients = new WeakMap<NativeTransactionTarget, InteropClient>()

function currentNative(): NativeTransactionTarget | undefined {
    return (currentInstance?.appContext.host as { native?: NativeTransactionTarget } | undefined)?.native ?? globalThis.__ARRANGE_NATIVE__
}

function client(): InteropClient {
    const native = currentNative()
    if (!native?.interop) throw new Error('当前宿主未连接 Interop，请在 EditorConfig.interop 中提供')
    let result = clients.get(native)
    if (!result) clients.set(native, result = new InteropClient(native.interop))
    return result
}

function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value))
}

function finite(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label}必须是有限数`)
    return value
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    let value = map.get(key)
    if (value === undefined) map.set(key, value = create())
    return value
}

function readonlyView<T extends object>(state: ShallowRef<T>, keys: readonly (keyof T)[]): T {
    const view = {} as T
    for (const key of keys) Object.defineProperty(view, key, { enumerable: true, get: () => state.value[key] })
    return Object.freeze(view)
}

// 宿主是否连接了 Interop；预览、测试夹具等无插件宿主的场景可据此降级
export function hasInterop(): boolean {
    return currentNative()?.interop !== undefined
}

export function useParameter(id: string): Parameter {
    return client().parameter(id)
}

export function useHost(): HostInfo {
    return client().host()
}

export function useTransport(): Transport {
    return client().transport()
}

export function useMeter(name: string): ComputedRef<number> {
    return client().meter(name)
}

export function useWaveform(name: string, options: { size: number }): ComputedRef<Float32Array> {
    if (!Number.isInteger(options.size) || options.size < 1) throw new RangeError('波形长度必须是正整数')
    return client().waveform(name, options.size)
}

export function useSpectrum(name: string): ComputedRef<Float32Array> {
    return client().spectrum(name)
}

export function onNativeEvent<T extends InteropValue = InteropValue>(name: string, handler: (value: T) => void): () => void {
    return client().onEvent(name, handler as (value: InteropValue) => void)
}

export function invokeNative<T extends InteropValue = InteropValue>(name: string, args: InteropValue = null): Promise<T> {
    return client().invoke<T>(name, args)
}
