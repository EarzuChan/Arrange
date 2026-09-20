import type {Modifier, ModifierElement} from "./modifier.ts"
import type {ArrangementName, AxisAlignment, ColorValue, HorizontalAlignment, VerticalAlignment} from "./primitives.ts"
import {ARRANGE_PROTOCOL_VERSION} from "./version.ts"
import type { PainterCompletion } from './painter.ts'
export type { Painter } from './painter.ts'

export type NodeId = number
export type NativeEventCallback = (...args: unknown[]) => unknown

export type NativeReloadPayload = {
    path?: string
    timestamp?: number
}

export type NativeDiagnosticPayload = {
    category?: string
    code?: string
    message?: string
    detail?: string
    source?: string
    pathOrUrl?: string
    toast?: boolean
}

export type TextStyleProp = Readonly<{
    fontSize?: number
    lineHeight?: number
    color?: ColorValue
}>

export type ArrangementProp<A extends AxisAlignment = AxisAlignment, N extends ArrangementName = ArrangementName> = N | Readonly<{
    kind: "spacedBy"
    space: number
    alignment?: A
}>

export type HorizontalArrangementProp = ArrangementProp<HorizontalAlignment, Exclude<ArrangementName, 'Top' | 'Bottom'>>
export type VerticalArrangementProp = ArrangementProp<VerticalAlignment, Exclude<ArrangementName, 'Start' | 'End'>>

export type ResourceRef =
    | string
    | Readonly<{path: string}>

export type NativePropValue =
    | string
    | number
    | boolean
    | NativeEventCallback
    | TextStyleProp
    | ArrangementProp
    | ResourceRef

export type NativeBindingHandle = Readonly<{identity: bigint; generation: bigint}>

export type NativeModifierHandle = NativeBindingHandle & Readonly<{key: string; kind: string}>

export type NativeTransactionTarget = {
    beginRearrange: () => void
    submitRearrange: (complete: (error?: string) => void) => void
    abortRearrange: () => void
    acquirePainter?: (resource: string, completion: (result: PainterCompletion) => void) => NativeBindingHandle
    releasePainter?: (handle: NativeBindingHandle) => void
    registerBinding: (id: NodeId, input: string) => NativeBindingHandle
    updateBinding: (handle: NativeBindingHandle, value: NativePropValue | Modifier | ModifierElement | null) => void
    releaseBinding: (handle: NativeBindingHandle) => void
    modifierInstances: (id: NodeId) => readonly NativeModifierHandle[]
    registerModifierBinding: (id: NodeId, instance: NativeModifierHandle) => NativeBindingHandle
    runtimeVersion?: number
    createNode: (id: NodeId, type: string) => void
    deleteNode: (id: NodeId) => void
    insertChild: (parent: NodeId, child: NodeId, index: number) => void
    removeChild: (parent: NodeId, child: NodeId) => void
    unmount: () => void
    reload?: (payload: NativeReloadPayload) => void
    diagnosticsLog?: (level: string, payload: NativeDiagnosticPayload) => void
    diagnosticsToast?: (payload: NativeDiagnosticPayload) => void
    diagnosticsRequestReload?: (payload?: NativeReloadPayload) => void
    diagnosticsTriggerFakeError?: (payload?: {message?: string}) => void
    diagnosticsCopyDiagnostics?: () => string
    diagnosticsCopyRecentEvents?: () => string
    diagnosticsSetLogLevel?: (level: string) => void
    diagnosticsSetCategoryEnabled?: (category: string, enabled: boolean) => void
    diagnosticsSetToastsEnabled?: (enabled: boolean) => void
}

export type NativeMutation = (target: NativeTransactionTarget) => void

export const ARRANGE_RUNTIME_VERSION = ARRANGE_PROTOCOL_VERSION
