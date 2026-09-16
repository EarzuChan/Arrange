import {ErrorCodes, callWithAsyncErrorHandling, createRenderer} from "@arrange/vue-runtime-core"
import type {App as VueApp, Component} from "@arrange/vue-runtime-core"
import {Text} from "./components.ts"
import {m, toModifier} from "./modifier.ts"
import {ARRANGE_RUNTIME_VERSION} from "./native.ts"
import type {NativeMutation, NativePropValue, NativeTransactionTarget, NodeId} from "./native.ts"
import type {ArrangeContainer, ArrangeHostNode} from "./types.ts"

declare global {
    var __ARRANGE_NATIVE__: NativeTransactionTarget | undefined
}

const eventPropNames = new Set(["onUpdate:modelValue", "onUpdate:model-value", "onSubmit", "onChange", "onBlur"])

function isNativePropValue(value: unknown): value is NativePropValue {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function toNativePropValue(key: string, value: unknown): NativePropValue {
    if (eventPropNames.has(key)) {
        if (typeof value === "function") return value as NativePropValue
        if (Array.isArray(value) && value.every(item => typeof item === "function")) {
            const callbacks = [...value]
            return (...args: unknown[]) => callWithAsyncErrorHandling(callbacks, null, ErrorCodes.NATIVE_EVENT_HANDLER, args)
        }
    }
    if (isNativePropValue(value)) return value
    throw new TypeError(`Arrange prop '${key}' cannot be sent to native: unsupported value type`)
}

function makeNode(type: string, kind: ArrangeHostNode["kind"] = "element"): ArrangeHostNode {
    return {
        $$arrangeVNode: true,
        type,
        kind,
        props: kind === "anchor" ? {} : {modifier: m},
        __arrangeBindings: new Map(),
        children: [],
    }
}

function hasNativeNode(node: ArrangeHostNode): boolean {
    return node.kind !== "anchor" && (node.kind !== "text" || node.props.text !== "" || !!node.__arrangeNodeId)
}

function makeTextNode(text: string): ArrangeHostNode {
    const node = makeNode(Text, "text")
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
    return container?.children.find(hasNativeNode) ?? null
}

function assignNodeIds(node: ArrangeHostNode | null | undefined, container: ArrangeContainer): void {
    if (!node || !hasNativeNode(node)) return
    if (!node.__arrangeNodeId) node.__arrangeNodeId = container.__arrangeNextNodeId++
    for (const child of node.children ?? []) assignNodeIds(child, container)
}

function inputMutation(node: ArrangeHostNode, key: string, value: unknown): NativeMutation {
    const id = node.__arrangeNodeId
    if (!id) throw new Error("Arrange binding target is missing native node id")
    const typed = key === "modifier" ? toModifier(value as never) : key === "text" ? String(value ?? "") : value == null ? null : toNativePropValue(key, value)
    return native => {
        let handle = node.__arrangeBindings.get(key)
        if (!handle) {
            handle = native.registerBinding(id, key)
            node.__arrangeBindings.set(key, handle)
        }
        native.updateBinding(handle, typed)
    }
}

function releaseSubtreeBindings(node: ArrangeHostNode): NativeMutation[] {
    const mutations: NativeMutation[] = []
    for (const child of node.children) mutations.push(...releaseSubtreeBindings(child))
    mutations.push(native => {
        for (const handle of node.__arrangeBindings.values()) native.releaseBinding(handle)
        node.__arrangeBindings.clear()
    })
    return mutations
}

function emitCreateSubtree(node: ArrangeHostNode | null | undefined, parentId: NodeId | null = null, index = 0, mutations: NativeMutation[] = []): NativeMutation[] {
    if (!node || !hasNativeNode(node)) return mutations
    const id = node.__arrangeNodeId
    if (!id) throw new Error("Arrange host node is missing native node id")
    mutations.push((native) => native.createNode(id, String(node.type)))
    for (const [key, value] of Object.entries(node.props ?? {})) {
        if (key === "modifier") continue
        mutations.push(inputMutation(node, key, value))
    }
    mutations.push(inputMutation(node, "modifier", node.props?.modifier ?? m))
    if (parentId != null) mutations.push((native) => native.insertChild(parentId, id, index))
    node.children.filter(hasNativeNode).forEach((child, childIndex) => emitCreateSubtree(child, id, childIndex, mutations))
    return mutations
}

function assertNativeRuntime(target: NativeTransactionTarget | null | undefined): void {
    const nativeVersion = target?.runtimeVersion
    if (nativeVersion == null) return
    if (nativeVersion !== ARRANGE_RUNTIME_VERSION) {
        throw new Error(`Arrange runtime/native version mismatch: runtime=${ARRANGE_RUNTIME_VERSION}, native=${nativeVersion}`)
    }
}

function commitMutations(target: NativeTransactionTarget, mutations: readonly NativeMutation[]): void {
    if (mutations.length === 0) return
    for (const mutation of mutations) mutation(target)
}

function scheduleCommitFrom(node: ArrangeHostNode | ArrangeContainer | null | undefined): void {
    const container = findContainer(node)
    if (!container?.__arrangeMounted || !container.__arrangeNative) return
    if (container.__arrangeNativeFlushPending) return
    container.__arrangeNativeFlushPending = true
    queueMicrotask(() => {
        container.__arrangeNativeFlushPending = false
        if (!container.__arrangeMounted || !container.__arrangeNative) return
        const mutations = container.__arrangePendingMutations.splice(0)
        commitMutations(container.__arrangeNative, mutations)
    })
}

function enqueueNativeMutation(node: ArrangeHostNode | ArrangeContainer, mutation: NativeMutation | NativeMutation[]): boolean {
    const container = findContainer(node)
    if (!container?.__arrangeMounted || !container.__arrangeNative) return false
    container.__arrangePendingMutations.push(...(Array.isArray(mutation) ? mutation : [mutation]))
    scheduleCommitFrom(node)
    return true
}

function clearNodeIds(node: ArrangeHostNode | null | undefined): void {
    if (!node) return
    delete node.__arrangeNodeId
    for (const child of node.children ?? []) clearNodeIds(child)
}

function nativeParentId(parent: ArrangeHostNode | ArrangeContainer): NodeId | undefined {
    return isHostNode(parent) ? parent.__arrangeNodeId : 1
}

function nativeIndex(node: ArrangeHostNode, parent: ArrangeHostNode | ArrangeContainer): number {
    return parent.children.slice(0, parent.children.indexOf(node)).filter(hasNativeNode).length
}

function insertHostNode(child: ArrangeHostNode, rawParent: ArrangeHostNode, anchor: ArrangeHostNode | null = null): void {
    const parent = rawParent as ArrangeHostNode | ArrangeContainer
    const oldParent = child.__arrangeParent
    const container = findContainer(parent)
    if (oldParent) {
        if (findContainer(oldParent) !== container) removeHostNode(child)
        else {
            const previousIndex = oldParent.children.indexOf(child)
            if (previousIndex >= 0) oldParent.children.splice(previousIndex, 1)
        }
    }
    child.__arrangeParent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    const parentId = nativeParentId(parent)
    if (!container?.__arrangeMounted || !parentId || !hasNativeNode(child)) return
    const existingId = child.__arrangeNodeId
    if (!existingId) assignNodeIds(child, container)
    const position = nativeIndex(child, parent)
    enqueueNativeMutation(parent, existingId
        ? native => native.insertChild(parentId, existingId, position)
        : emitCreateSubtree(child, parentId, position))
}

function removeHostNode(child: ArrangeHostNode): void {
    const parent = child.__arrangeParent
    if (!parent) return
    const parentId = nativeParentId(parent)
    const childId = child.__arrangeNodeId
    if (parentId && childId) {
        enqueueNativeMutation(parent, [
            ...releaseSubtreeBindings(child),
            native => native.removeChild(parentId, childId),
            native => native.deleteNode(childId),
        ])
        clearNodeIds(child)
    }
    const index = parent.children.indexOf(child)
    if (index >= 0) parent.children.splice(index, 1)
    child.__arrangeParent = null
}

function setNodeText(node: ArrangeHostNode, text: string): void {
    node.props.text = String(text)
    if (node.__arrangeNodeId) enqueueNativeMutation(node, inputMutation(node, "text", text))
    else if (text && node.kind === "text") {
        const container = findContainer(node)
        const parent = node.__arrangeParent
        const parentId = parent && nativeParentId(parent)
        if (container?.__arrangeMounted && parent && parentId) {
            assignNodeIds(node, container)
            enqueueNativeMutation(parent, emitCreateSubtree(node, parentId, nativeIndex(node, parent)))
        }
    }
}

const renderer = createRenderer<ArrangeHostNode, ArrangeHostNode>({
    patchProp(el, key, _previous, next, _namespace, owner) {
        if (eventPropNames.has(key) && next != null) {
            const callbacks = next
            next = (...args: unknown[]) => callWithAsyncErrorHandling(callbacks, owner ?? null, ErrorCodes.NATIVE_EVENT_HANDLER, args)
        }
        if (key === "class" || key === "style") throw new TypeError(`Arrange 不支持 ${key}，请使用 Modifier`)
        el.props[key] = key === "modifier" ? toModifier(next ?? m) : next
        if (el.__arrangeNodeId) enqueueNativeMutation(el, inputMutation(el, key, el.props[key]))
    },
    insert: insertHostNode,
    remove: removeHostNode,
    createElement: type => makeNode(type),
    createText: makeTextNode,
    createComment: () => makeNode("Anchor", "anchor"),
    setText: setNodeText,
    setElementText(node, text) {
        for (const child of [...node.children]) removeHostNode(child)
        if (node.type === Text) setNodeText(node, text)
        else if (text !== "") insertHostNode(makeTextNode(text), node)
    },
    parentNode(node) {
        return (node.__arrangeParent ?? null) as ArrangeHostNode | null
    },
    nextSibling(node) {
        const parent = node.__arrangeParent
        if (!parent) return null
        const index = parent.children.indexOf(node)
        return index >= 0 ? parent.children[index + 1] ?? null : null
    },
})

export type ArrangeMountHandle = {tree: ArrangeHostNode | null; unmount: () => void}
export type ArrangeApp = Omit<VueApp, "mount"> & {mount: (target?: NativeTransactionTarget) => unknown}
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
    let nativeTarget: NativeTransactionTarget | null = null

    app.unmount = () => {
        if (!container) return originalUnmount()
        const target = nativeTarget
        originalUnmount()
        container.__arrangePendingMutations.length = 0
        container.__arrangeMounted = false
        container.__arrangeNativeFlushPending = false
        target?.unmount()
        container = null
        nativeTarget = null
    }

    app.mount = (target: NativeTransactionTarget = globalThis.__ARRANGE_NATIVE__!) => {
        if (!target?.registerBinding || !target.updateBinding || !target.releaseBinding) throw new Error("Arrange native binding runtime is required")
        assertNativeRuntime(target)
        for (const operation of ['createNode', 'deleteNode', 'insertChild', 'removeChild', 'unmount'] as const) {
            if (typeof target[operation] !== 'function') throw new Error(`Arrange native runtime is missing ${operation}`)
        }
        nativeTarget = target
        container = {
            $$arrangeContainer: true,
            children: [],
            __arrangeNative: target,
            __arrangeNativeFlushPending: false,
            __arrangeMounted: false,
            __arrangeNextNodeId: 2,
            __arrangePendingMutations: [],
        }
        const result = originalMount(containerAsMountHost(container))
        for (const child of container.children) assignNodeIds(child, container)
        container.__arrangeMounted = true
        const initial: NativeMutation[] = [native => native.createNode(1, "Root")]
        container.children.filter(hasNativeNode).forEach((child, index) => emitCreateSubtree(child, 1, index, initial))
        commitMutations(target, initial)

        if (result && (typeof result === "object" || typeof result === "function")) {
            try {
                Object.defineProperty(result, "tree", {configurable: true, get: () => currentTree(container)})
                Object.defineProperty(result, "unmount", {configurable: true, value: () => app.unmount()})
                return result
            } catch {
                // Vue component public instances are proxies; if a host rejects augmentation,
                // fall through to the Arrange mount handle used by tests/smoke.
            }
        }
        return {tree: currentTree(container), unmount: () => app.unmount()} satisfies ArrangeMountHandle
    }
    return app
}
