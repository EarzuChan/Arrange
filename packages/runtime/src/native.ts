import type {Modifier} from "./modifier.ts"
import type {ColorValue} from "./primitives.ts"

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
    fontWeight?: string
    fontFamily?: string
}>

export type ArrangementProp = string | Readonly<{
    kind: "spacedBy"
    space: number
    alignment?: string
}>

export type ResourceRef =
    | string
    | Readonly<{path: string; url?: never}>
    | Readonly<{url: string; path?: never}>

export type NativePropValue =
    | string
    | number
    | boolean
    | NativeEventCallback
    | TextStyleProp
    | ArrangementProp
    | ResourceRef

export type NativeTransactionTarget = {
    runtimeVersion?: number
    beginTransaction?: () => void
    endTransaction?: () => void
    createNode?: (id: NodeId, type: string) => void
    deleteNode?: (id: NodeId) => void
    insertChild?: (parent: NodeId, child: NodeId, index: number) => void
    removeChild?: (parent: NodeId, child: NodeId) => void
    setText?: (id: NodeId, text: string) => void
    setProp?: (id: NodeId, key: string, value: NativePropValue) => void
    setModifier?: (id: NodeId, modifier: Modifier) => void
    invalidate?: (id: NodeId, flag: string, reason?: string) => void
    unmount?: () => void
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

export const ARRANGE_RUNTIME_VERSION = 1
