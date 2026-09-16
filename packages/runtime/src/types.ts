import type {Modifier} from "./modifier.ts"
import type {NativeBindingHandle, NativeMutation, NativeTransactionTarget, NodeId} from "./native.ts"

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

export type ArrangeHostNode = Omit<ArrangeElementVNode, "children"> & {
    kind: "element" | "text" | "anchor"
    children: ArrangeHostNode[]
    __arrangeParent?: ArrangeHostNode | ArrangeContainer | null
    __arrangeNodeId?: NodeId
    __arrangeBindings: Map<string, NativeBindingHandle>
}

export type ArrangeContainer = {
    $$arrangeContainer: true
    children: ArrangeHostNode[]
    __arrangeNative?: NativeTransactionTarget
    __arrangeNativeFlushPending: boolean
    __arrangeMounted: boolean
    __arrangeNextNodeId: NodeId
    __arrangePendingMutations: NativeMutation[]
}

export type ArrangeRenderRoot =
    | ArrangeHostNode
    | (() => ArrangeHostNode)
    | {render: () => ArrangeHostNode}

export type ModifierElement = {
    type: string
    value: Record<string, unknown>
}

export type ArrangeRenderInput =
    | ArrangeVNode
    | (() => ArrangeVNode)
    | {render: () => ArrangeVNode}
