import type { PxModifier } from './modifierLowering.ts'
import type { Modifier, ModifierElement } from "./modifier.ts"
import type { ArrangementName, AxisAlignment, HorizontalAlignment, VerticalAlignment } from "./primitives.ts"
import { ARRANGE_PROTOCOL_VERSION } from "./version.ts"
import type { PainterCompletion } from './painter.ts'
export type { Painter } from './painter.ts'

export type NodeId = number
export type NativeEventCallback = (...args: unknown[]) => unknown

export type NativeReloadPayload = {
    path?: string
    timestamp?: number
}

export type TextStyleProp = Readonly<{
    fontSize?: number
    lineHeight?: number
    color?: number
}>

export type ArrangementProp<A extends AxisAlignment = AxisAlignment, N extends ArrangementName = ArrangementName> = N | Readonly<{
    kind: "spacedBy"
    spaceDp: number
    spacePx: number
    alignment?: A
}>

export type HorizontalArrangementProp = ArrangementProp<HorizontalAlignment, Exclude<ArrangementName, 'Top' | 'Bottom'>>
export type VerticalArrangementProp = ArrangementProp<VerticalAlignment, Exclude<ArrangementName, 'Start' | 'End'>>

export type ResourceRef =
    | string
    | Readonly<{ path: string }>

export type NativePropValue = | string | number | boolean | NativeEventCallback | TextStyleProp | ArrangementProp | ResourceRef

export type NativeBindingHandle = Readonly<{ identity: bigint; generation: bigint }>

export type NativeModifierHandle = NativeBindingHandle & Readonly<{ key: string; kind: string }>

export type NativeInteropValue = null | boolean | number | string | readonly NativeInteropValue[] | { readonly [key: string]: NativeInteropValue }

export type NativeParameterDescriptor = Readonly<{
    index: number
    id: string
    name: string
    label: string
    defaultNormalized: number
    steps: number
    discrete: boolean
    boolean: boolean
    minimum: number
    maximum: number
    value: number
}>

export type NativeHostFormat = 'standalone' | 'vst3' | 'au' | 'aax' | 'lv2' | 'unknown'

export type NativeHostInfo = Readonly<{ name: string | null; format: NativeHostFormat; sampleRate: number | null; blockSize: number | null }>

export type NativeTransport = Readonly<{
    playing: boolean
    recording: boolean
    looping: boolean
    bpm: number | null
    timeSignature: Readonly<{ numerator: number; denominator: number }> | null
    positionPpq: number | null
    positionSeconds: number | null
}>

export interface NativeInteropDriver {
    parameters(indices: readonly number[], values: readonly number[]): void
    host(info: NativeHostInfo): void
    transport(state: NativeTransport): void
    meter(name: string, level: number): void
    waveform(name: string, samples: Float32Array): void
    spectrum(name: string, values: Float32Array): void
    message(name: string, value: NativeInteropValue): void
    reply(id: number, ok: boolean, value: NativeInteropValue, error: string): void
}

export type NativeInterop = {
    install: (driver: NativeInteropDriver) => void
    parameters: () => readonly NativeParameterDescriptor[]
    parameterValue: (index: number) => number
    toPlain: (index: number, normalized: number) => number
    toNormalized: (index: number, value: number) => number
    text: (index: number, normalized: number) => string
    parse: (index: number, text: string) => number | null
    gesture: (index: number, phase: 'begin' | 'end') => void
    set: (index: number, normalized: number, complete: boolean) => void
    hostMenu: (index: number) => boolean
    host: () => NativeHostInfo
    transport: () => NativeTransport
    subscribe: (kind: 'meter' | 'waveform' | 'spectrum' | 'transport', name: string, size?: number) => number
    unsubscribe: (id: number) => void
    invoke: (name: string, args: NativeInteropValue) => number
}

// 真实宿主（QuickJsNativeApi）必然提供的成员均为必选；interop 只在宿主连接 Interop 时出现
export type NativeTransactionTarget = {
    focusCommand: (operation: 'request' | 'clear' | 'move' | 'cancel', requester: number, direction?: import('./focus.ts').FocusDirection) => boolean
    installFrameDriver: (prepare: (time: number) => void, complete: (success: boolean) => void, dispose: () => void) => void
    installLayoutDriver: (materialize: (id: NodeId, indices: readonly number[]) => void) => void
    continueRearrange: () => void
    currentTime: () => number
    requestFrame: (pending: boolean) => void
    beginRearrange: () => void
    submitRearrange: (complete: (error?: string) => void) => void
    abortRearrange: () => void
    acquirePainter: (resource: string, completion: (result: PainterCompletion) => void) => NativeBindingHandle
    releasePainter: (handle: NativeBindingHandle) => void
    registerBinding: (id: NodeId, input: string) => NativeBindingHandle
    updateBinding: (handle: NativeBindingHandle, value: NativePropValue | import('./measurePolicy.ts').MeasurePolicy | PxModifier | ModifierElement | null) => void
    releaseBinding: (handle: NativeBindingHandle) => void
    modifierInstances: (id: NodeId) => readonly NativeModifierHandle[]
    registerModifierBinding: (id: NodeId, instance: NativeModifierHandle) => NativeBindingHandle
    runtimeVersion: number
    createNode: (id: NodeId, type: string) => void
    deleteNode: (id: NodeId) => void
    insertChild: (parent: NodeId, child: NodeId, index: number) => void
    removeChild: (parent: NodeId, child: NodeId) => void
    unmount: () => void
    log: (level: string, tag: string, args: string[]) => void
    diagnosticsToast: (level: string, tag: string, title: string, args: string[], coalesce: boolean) => void
    diagnosticsRequestReload: (payload?: NativeReloadPayload) => void
    diagnosticsTriggerFakeError: (payload?: { message?: string }) => void
    diagnosticsSetToastsEnabled: (enabled: boolean) => void
    interop?: NativeInterop
}

export type NativeMutation = (target: NativeTransactionTarget) => void

export const ARRANGE_RUNTIME_VERSION = ARRANGE_PROTOCOL_VERSION
