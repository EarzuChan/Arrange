import type {BridgeEncodedValue, BridgeOp, EventSlotId, NativeCommitTarget, NodeId} from "./bridge.ts"
import type {Modifier} from "./modifier.ts"

export type ArrangeVNode = ArrangeElementVNode | string | number
export type ArrangeChild = ArrangeVNode | null | undefined

export type ArrangeHostProps = {
    modifier?: Modifier
    text?: string | number
    modelValue?: string
    "model-value"?: string
    value?: string
    [key: string]: unknown
}

export type ArrangeElementVNode = {
    $$arrangeVNode: true
    $$arrangeContainer?: false
    type: string
    props: ArrangeHostProps
    children: ArrangeVNode[]
}

export type ArrangeHostEventListener = (event: ArrangeHostEvent) => void

export type ArrangeHostNode = Omit<ArrangeElementVNode, "children"> & {
    tagName: string
    children: ArrangeHostNode[]
    __arrangeParent?: ArrangeHostNode | ArrangeContainer | null
    __arrangeBridgeId?: NodeId
    __arrangeListeners: Map<string, ArrangeHostEventListener[]>
    addEventListener: (name: string, listener: ArrangeHostEventListener) => void
    removeEventListener: (name: string, listener: ArrangeHostEventListener) => void
    getRootNode: () => {activeElement: null}
    dispatchArrangeEvent: (name: string, value?: string) => void
    value: string
}

export type ArrangeContainer = {
    $$arrangeContainer: true
    children: ArrangeHostNode[]
    __arrangeCommit?: NativeCommitTarget["commit"]
    __arrangeCommitPending: boolean
    __arrangeMounted: boolean
    __arrangeNextBridgeId: NodeId
    __arrangePendingOps: BridgeOp[]
}

export type ArrangeHostEvent = {
    target: ArrangeHostNode
    currentTarget: ArrangeHostNode
    type: string
}

export type ArrangeRenderRoot =
    | ArrangeHostNode
    | (() => ArrangeHostNode)
    | {render: () => ArrangeHostNode}

export type ModifierElement = {
    type: string
    value: Record<string, unknown>
}

export type NativeModifierProp = {
    key: string
    value: BridgeEncodedValue | EventSlotId
}

export type ArrangeRenderInput =
    | ArrangeVNode
    | (() => ArrangeVNode)
    | {render: () => ArrangeVNode}

export type NativeModifierPropEntry = NativeModifierProp
