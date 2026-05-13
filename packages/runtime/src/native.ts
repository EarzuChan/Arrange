import type {Modifier} from "./modifier.ts"

export type NodeId = number
export type NativeEventCallback = (...args: unknown[]) => unknown

export type NativeReloadPayload = {
    path?: string
    timestamp?: number
}

export type NativeTransactionTarget = {
    runtimeVersion?: number
    beginTransaction?: () => void
    endTransaction?: () => void
    createNode?: (id: NodeId, type: string) => void
    deleteNode?: (id: NodeId) => void
    insertChild?: (parent: NodeId, child: NodeId, index: number) => void
    removeChild?: (parent: NodeId, child: NodeId) => void
    setText?: (id: NodeId, text: string) => void
    setProp?: (id: NodeId, key: string, value: unknown) => void
    setModifier?: (id: NodeId, modifier: Modifier) => void
    invalidate?: (id: NodeId, flag: string, reason?: string) => void
    unmount?: () => void
    reload?: (payload: NativeReloadPayload) => void
}

export type NativeMutation = (target: NativeTransactionTarget) => void

export const ARRANGE_RUNTIME_VERSION = 1
