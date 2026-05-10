import {createRenderer} from "vue"
import type {App as VueApp, Component} from "vue"
import {Text} from "./components.ts"
import {m, toModifier} from "./modifier.ts"
import type {Modifier} from "./modifier.ts"
import {BridgeOpWriter, eventSlotPropForProp, serializeModifier, serializeProp} from "./renderer.ts"
import {BRIDGE_VERSION} from "./bridge.ts"
import type {BridgeOp, NativeCommitCommand, NativeCommitTarget, NodeId} from "./bridge.ts"
import type {ArrangeContainer, ArrangeHostEvent, ArrangeHostEventListener, ArrangeHostNode, ArrangeVNode} from "./types.ts"

type CommitOp = BridgeOp | NativeCommitCommand

declare global {
    var __ARRANGE_NATIVE__: NativeCommitTarget | undefined
}

function makeNode(type: string): ArrangeHostNode {
    const node = {
        $$arrangeVNode: true,
        type,
        tagName: String(type).toUpperCase(),
        props: {modifier: m},
        children: [] as ArrangeHostNode[],
        __arrangeListeners: new Map<string, ArrangeHostEventListener[]>(),
        addEventListener(this: ArrangeHostNode, name: string, listener: ArrangeHostEventListener): void {
            const list = this.__arrangeListeners.get(name) ?? []
            list.push(listener)
            this.__arrangeListeners.set(name, list)
        },
        removeEventListener(this: ArrangeHostNode, name: string, listener: ArrangeHostEventListener): void {
            const list = this.__arrangeListeners.get(name)
            if (!list) return
            const index = list.indexOf(listener)
            if (index >= 0) list.splice(index, 1)
        },
        getRootNode(): {activeElement: null} {
            return {activeElement: null}
        },
        dispatchArrangeEvent(this: ArrangeHostNode, name: string, value: string = this.value): void {
            this.value = value
            const event: ArrangeHostEvent = {target: this, currentTarget: this, type: name}
            for (const listener of this.__arrangeListeners.get(name) ?? []) listener(event)
        },
    }
    Object.defineProperty(node, "value", {
        configurable: true,
        get(this: ArrangeHostNode): string {
            return String(this.props.modelValue ?? this.props["model-value"] ?? this.props.value ?? "")
        },
        set(this: ArrangeHostNode, next: unknown) {
            const value = next == null ? "" : String(next)
            this.props.modelValue = value
            this.props.value = value
            scheduleCommitFrom(this)
        },
    })
    return node as ArrangeHostNode
}

function makeTextNode(text: string): ArrangeHostNode {
    const node = makeNode(Text)
    node.props.text = String(text)
    return node
}

function isHostNode(value: unknown): value is ArrangeHostNode {
    return Boolean(value && typeof value === "object" && (value as {$$arrangeVNode?: unknown}).$$arrangeVNode)
}

function findContainer(node: ArrangeHostNode | ArrangeContainer | null | undefined): ArrangeContainer | null {
    let current: ArrangeHostNode | ArrangeContainer | null | undefined = node
    while (current && !(current as ArrangeContainer).$$arrangeContainer) current = (current as ArrangeHostNode).__arrangeParent ?? null
    return current && (current as ArrangeContainer).$$arrangeContainer ? current as ArrangeContainer : null
}

function currentTree(container: ArrangeContainer | null | undefined): ArrangeHostNode | null {
    return container?.children?.[0] ?? null
}

function assignBridgeIds(node: ArrangeHostNode | null | undefined, container: ArrangeContainer): void {
    if (!node) return
    if (!node.__arrangeBridgeId) node.__arrangeBridgeId = container.__arrangeNextBridgeId++
    for (const child of node.children ?? []) assignBridgeIds(child, container)
}

function emitCreateSubtree(node: ArrangeHostNode | null | undefined, parentId: NodeId | null = null, index = 0, ops: BridgeOp[] = []): BridgeOp[] {
    if (!node) return ops
    const writer = new BridgeOpWriter()
    writer.emitHostSubtree(node, parentId, index)
    ops.push(...writer.ops)
    return ops
}

function assertNativeProtocol(target: NativeCommitTarget | null | undefined): void {
    const nativeVersion = target?.protocolVersion ?? target?.bridgeVersion
    if (nativeVersion == null) return
    if (nativeVersion !== BRIDGE_VERSION) {
        throw new Error(`Arrange runtime/native bridge version mismatch: runtime=${BRIDGE_VERSION}, native=${nativeVersion}`)
    }
}

function scheduleCommitFrom(node: ArrangeHostNode | ArrangeContainer | null | undefined): void {
    const container = findContainer(node)
    if (!container?.__arrangeMounted || typeof container.__arrangeCommit !== "function") return
    if (container.__arrangeCommitPending) return
    container.__arrangeCommitPending = true
    queueMicrotask(() => {
        container.__arrangeCommitPending = false
        if (!container.__arrangeMounted) return
        const ops = container.__arrangePendingOps.splice(0)
        if (ops.length > 0) container.__arrangeCommit?.(ops)
    })
}

function enqueueBridgeOps(node: ArrangeHostNode | ArrangeContainer, ops: BridgeOp | BridgeOp[]): boolean {
    const container = findContainer(node)
    if (!container?.__arrangeMounted || typeof container.__arrangeCommit !== "function") return false
    container.__arrangePendingOps.push(...(Array.isArray(ops) ? ops : [ops]))
    scheduleCommitFrom(node)
    return true
}

function emitModifierOps(id: NodeId, modifier: Modifier | null | undefined, _includeDisabled: boolean, ops: BridgeOp[]): void {
    ops.push({op: "setModifier", id, modifier: serializeModifier(modifier ?? m, id)})
}

function clearBridgeIds(node: ArrangeHostNode | null | undefined): void {
    if (!node) return
    delete node.__arrangeBridgeId
    for (const child of node.children ?? []) clearBridgeIds(child)
}

const renderer = createRenderer<ArrangeHostNode, ArrangeHostNode>({
    patchProp(el, key, _previous, next) {
        if (key === "class" || key === "style") return
        el.props[key] = key === "modifier" ? toModifier(next ?? m) : next
        const id = el.__arrangeBridgeId
        if (!id) return
        if (key === "modifier") {
            const modifier = el.props.modifier ?? m
            const ops: BridgeOp[] = []
            emitModifierOps(id, modifier, true, ops)
            enqueueBridgeOps(el, ops)
        } else if (key === "text" && el.type === Text) enqueueBridgeOps(el, {op: "setText", id, text: String(next)})
        else {
            const slotProp = eventSlotPropForProp(id, key, el.props[key])
            enqueueBridgeOps(el, {op: "setProp", id, key, value: slotProp ?? serializeProp(el.props[key])})
        }
    },
    insert(child, rawParent, anchor = null) {
        const parent = rawParent as ArrangeHostNode | ArrangeContainer
        parent.children ??= []
        const current = parent.children.indexOf(child)
        if (current >= 0) parent.children.splice(current, 1)
        child.__arrangeParent = parent
        if (anchor == null) parent.children.push(child)
        else {
            const index = parent.children.indexOf(anchor)
            parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
        }
        const container = findContainer(parent)
        const parentId = isHostNode(parent) ? parent.__arrangeBridgeId : undefined
        if (container?.__arrangeMounted && parentId) {
            const existingId = child.__arrangeBridgeId
            if (!existingId) assignBridgeIds(child, container)
            const index = parent.children.indexOf(child)
            enqueueBridgeOps(parent, existingId
                ? {op: "insertChild", parent: parentId, child: existingId, index}
                : emitCreateSubtree(child, parentId, index, []))
        }
    },
    remove(child) {
        const parent = child.__arrangeParent
        if (!parent?.children) return
        const parentId = isHostNode(parent) ? parent.__arrangeBridgeId : undefined
        const childId = child.__arrangeBridgeId
        const index = parent.children.indexOf(child)
        if (index >= 0) parent.children.splice(index, 1)
        child.__arrangeParent = null
        if (parentId && childId) {
            enqueueBridgeOps(parent, [
                {op: "removeChild", parent: parentId, child: childId},
                {op: "deleteNode", id: childId},
            ])
            clearBridgeIds(child)
        }
    },
    createElement(type) {
        return makeNode(type)
    },
    createText(text) {
        return makeTextNode(text)
    },
    createComment(text) {
        const node = makeNode("Comment")
        node.props.text = String(text ?? "")
        return node
    },
    setText(node, text) {
        node.props.text = String(text)
        if (node.__arrangeBridgeId) enqueueBridgeOps(node, {op: "setText", id: node.__arrangeBridgeId, text: String(text)})
    },
    setElementText(node, text) {
        node.children = []
        if (node.type === Text) node.props.text = String(text)
        else if (text !== "") {
            const child = makeTextNode(text)
            child.__arrangeParent = node
            node.children.push(child)
        }
        if (node.__arrangeBridgeId) {
            if (node.type === Text) enqueueBridgeOps(node, {op: "setText", id: node.__arrangeBridgeId, text: String(text)})
            else enqueueBridgeOps(node, {op: "setProp", id: node.__arrangeBridgeId, key: "__arrangeSubtreeReplaced", value: true})
        }
    },
    parentNode(node) {
        return isHostNode(node.__arrangeParent) ? node.__arrangeParent : null
    },
    nextSibling(node) {
        const parent = node.__arrangeParent
        if (!parent?.children) return null
        const index = parent.children.indexOf(node)
        return index >= 0 ? parent.children[index + 1] ?? null : null
    },
})

export type ArrangeMountHandle = {tree: ArrangeHostNode | null; unmount: () => void}
export type ArrangeApp = Omit<VueApp, "mount"> & {mount: (target?: NativeCommitTarget) => unknown}
type ArrangeVueAppBoundary = ArrangeApp & {unmount: () => void}

function createArrangeVueApp(rootComponent: Component, rootProps: Record<string, unknown> | null): {app: ArrangeVueAppBoundary; vueApp: VueApp} {
    const vueApp = renderer.createApp(rootComponent, rootProps)
    return {app: vueApp as unknown as ArrangeVueAppBoundary, vueApp}
}

function containerAsMountHost(container: ArrangeContainer): ArrangeHostNode {
    return container as unknown as ArrangeHostNode
}

export function createApp(rootComponent: Component, rootProps: Record<string, unknown> | null = null): ArrangeApp {
    const {app, vueApp} = createArrangeVueApp(rootComponent, rootProps)
    const originalMount = vueApp.mount.bind(vueApp)
    const originalUnmount = app.unmount.bind(app)
    let container: ArrangeContainer | null = null
    let nativeTarget: NativeCommitTarget | null = null

    app.unmount = () => {
        if (!container) return originalUnmount()
        const target = nativeTarget
        originalUnmount()
        container.__arrangeMounted = false
        container.__arrangeCommitPending = false
        if (target && typeof target.commit === "function") target.commit([{op: "unmount"}])
        container = null
        nativeTarget = null
    }

    app.mount = (target: NativeCommitTarget = globalThis.__ARRANGE_NATIVE__ ?? {}) => {
        assertNativeProtocol(target)
        nativeTarget = target
        container = {
            $$arrangeContainer: true,
            children: [],
            __arrangeCommit: target?.commit?.bind(target),
            __arrangeCommitPending: false,
            __arrangeMounted: false,
            __arrangeNextBridgeId: 1,
            __arrangePendingOps: [],
        }
        if (typeof globalThis.Document !== "function") {
            Object.defineProperty(globalThis, "Document", {configurable: true, writable: true, value: function ArrangeDocument() {}})
        }
        if (typeof globalThis.ShadowRoot !== "function") {
            Object.defineProperty(globalThis, "ShadowRoot", {configurable: true, writable: true, value: function ArrangeShadowRoot() {}})
        }
        const result = originalMount(containerAsMountHost(container))
        assignBridgeIds(currentTree(container), container)
        container.__arrangeMounted = true
        if (target && typeof target.commit === "function") target.commit(emitCreateSubtree(currentTree(container), null, 0, []))

        if (result && (typeof result === "object" || typeof result === "function")) {
            try {
                Object.defineProperty(result, "tree", {configurable: true, get: () => currentTree(container)})
                Object.defineProperty(result, "unmount", {configurable: true, value: () => app.unmount()})
                return result
            } catch {
                // Vue component public instances are proxies; if a host rejects augmentation,
                // fall through to the minimal Arrange mount handle used by tests/smoke.
            }
        }
        return {tree: currentTree(container), unmount: () => app.unmount()} satisfies ArrangeMountHandle
    }
    return app
}
