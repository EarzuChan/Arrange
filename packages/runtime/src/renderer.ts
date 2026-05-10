import type {BridgeEncodedValue, BridgeEventSlotBinding, BridgeEventSlotCallback, BridgeModifierElement, BridgeModifierValue, BridgeOp, NodeId} from "./bridge.ts"
import type {Modifier} from "./modifier.ts"
import type {ArrangeHostNode, ArrangeRenderInput, ArrangeVNode} from "./types.ts"
import {Text} from "./components.ts"

export function renderToBridgeOps(root: ArrangeRenderInput): BridgeOp[] {
    return renderToBridgeBatch(root).ops
}

export function renderToBridgeBatch(root: ArrangeRenderInput): {ops: BridgeOp[]} {
    const vnode = evaluateRoot(typeof root === "function" ? root : () => root)
    const writer = new BridgeOpWriter()
    writer.mount(vnode)
    return {ops: writer.ops}
}

function evaluateRoot(root: () => ArrangeRenderInput | ArrangeVNode): ArrangeVNode {
    const value = root()
    if (typeof value === "function") return evaluateRoot(value)
    if (value && typeof value === "object" && "render" in value && typeof value.render === "function") return value.render()
    if (typeof value === "string" || typeof value === "number" || (value && typeof value === "object" && "$$arrangeVNode" in value)) return value as ArrangeVNode
    throw new TypeError("Arrange render root must be a VNode, render object, or function")
}

export type SerializedModifierElement = BridgeModifierElement
export type SerializedModifier = SerializedModifierElement[]

export class BridgeOpWriter {
    readonly ops: BridgeOp[] = []
    #nextId = 1

    mount(root: ArrangeVNode | ArrangeHostNode | null | undefined): void {
        if (root == null) return
        const node = normalizeVNode(root)
        this.emitNode(node)
    }

    emitHostSubtree(node: ArrangeHostNode, parentId: NodeId | null = null, index = 0): void {
        this.emitNode(node, parentId, index)
    }

    private emitNode(node: ArrangeHostNode, parentId: NodeId | null = null, index = 0): NodeId {
        const id = node.__arrangeBridgeId ?? this.#nextId++
        node.__arrangeBridgeId = id
        this.ops.push({op: "createNode", id, nodeType: bridgeType(node)})
        for (const [key, value] of Object.entries(node.props ?? {})) {
            if (key === "modifier") continue
            if (key === "text" && node.type === Text) this.ops.push({op: "setText", id, text: String(value)})
            else {
                const slotProp = eventSlotPropForProp(id, key, value)
                this.ops.push({op: "setProp", id, key, value: slotProp ?? serializeProp(value)})
            }
        }
        this.ops.push({op: "setModifier", id, modifier: serializeModifier(node.props?.modifier, id)})
        if (parentId != null) this.ops.push({op: "insertChild", parent: parentId, child: id, index})
        node.children?.forEach((child, childIndex) => this.emitNode(child, id, childIndex))
        return id
    }
}

function normalizeVNode(vnode: ArrangeVNode | ArrangeHostNode): ArrangeHostNode {
    if (typeof vnode === "string" || typeof vnode === "number") {
        return hostNode(Text, {text: String(vnode)}, [])
    }
    if (isHostNode(vnode)) return vnode
    return hostNode(vnode.type, vnode.props ?? {}, vnode.children.map((child) => normalizeVNode(child)))
}

function hostNode(type: string, props: ArrangeHostNode["props"], children: ArrangeHostNode[]): ArrangeHostNode {
    return {
        $$arrangeVNode: true,
        type,
        tagName: String(type).toUpperCase(),
        props,
        children,
        __arrangeListeners: new Map(),
        addEventListener(name, listener) {
            const list = this.__arrangeListeners.get(name) ?? []
            list.push(listener)
            this.__arrangeListeners.set(name, list)
        },
        removeEventListener(name, listener) {
            const list = this.__arrangeListeners.get(name)
            if (!list) return
            const found = list.indexOf(listener)
            if (found >= 0) list.splice(found, 1)
        },
        getRootNode() {
            return {activeElement: null}
        },
        dispatchArrangeEvent() {},
        get value() { return String(this.props.value ?? "") },
        set value(next: string) { this.props.value = next },
    } satisfies ArrangeHostNode
}

function isHostNode(value: unknown): value is ArrangeHostNode {
    return Boolean(value && typeof value === "object" && (value as {$$arrangeVNode?: unknown}).$$arrangeVNode)
}

function bridgeType(node: ArrangeHostNode): string {
    return typeof node.type === "string" ? node.type : String(node.type ?? "Unknown")
}

export function serializeModifier(modifier: Modifier | null | undefined, nodeId?: NodeId): SerializedModifier {
    return (modifier?.elements ?? []).map((element) => {
        const value = serializeModifierValue(element.value)
        if (nodeId != null && element.type === "clickable" && typeof element.value.onClick === "function") {
            value.onClick = {eventSlot: `${nodeId}:click:click`, callback: element.value.onClick as BridgeEventSlotCallback}
        }
        if (nodeId != null && (element.type === "verticalScroll" || element.type === "horizontalScroll")) {
            const state = element.value.state
            const kind = element.type
            if (state && typeof state === "object" && typeof (state as {__arrangeNativeScroll?: unknown}).__arrangeNativeScroll === "function") {
                value.state = {
                    ...(value.state && typeof value.state === "object" ? value.state : {}),
                    __arrangeNativeScroll: {eventSlot: `${nodeId}:${kind}:${kind}`, callback: (state as {__arrangeNativeScroll: BridgeEventSlotCallback}).__arrangeNativeScroll},
                }
            }
        }
        return {type: element.type, ...value}
    })
}

function serializeModifierValue(value: unknown): Record<string, BridgeModifierValue> {
    const serialized = serializeModifierChild(value)
    return serialized && typeof serialized === "object" && !Array.isArray(serialized) ? serialized as Record<string, BridgeModifierValue> : {}
}

function serializeModifierChild(value: unknown): BridgeModifierValue {
    if (typeof value === "function") return null
    if (Array.isArray(value)) return value.map((child) => serializeModifierChild(child))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeModifierChild(child)]))
    return value as BridgeModifierValue
}

export function serializeProp(value: unknown): BridgeEncodedValue {
    if (typeof value === "function") return "[Function]"
    if (Array.isArray(value)) return value.map(serializeProp)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeProp(child)]))
    return value as BridgeEncodedValue
}

export function eventSlotPropForProp(nodeId: NodeId, key: string, value: unknown): BridgeEventSlotBinding | null {
    if (typeof value !== "function") return null
    const kind = inputEventKind(key)
    if (!kind) return null
    return {eventSlot: `${nodeId}:${kind}:${kind}`, callback: value as BridgeEventSlotCallback}
}

function inputEventKind(key: string): string | null {
    if (key === "onUpdate:modelValue" || key === "onUpdate:model-value") return "inputUpdate"
    if (key === "onSubmit") return "inputSubmit"
    if (key === "onChange") return "inputChange"
    if (key === "onBlur") return "inputBlur"
    return null
}
