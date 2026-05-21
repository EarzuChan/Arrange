import {createRenderer} from "@arrange/vue-runtime-core"
import type {App as VueApp, Component} from "@arrange/vue-runtime-core"
import {Text} from "./components.ts"
import {m, toModifier} from "./modifier.ts"
import {ARRANGE_RUNTIME_VERSION} from "./native.ts"
import type {NativeMutation, NativePropValue, NativeTransactionTarget, NodeId} from "./native.ts"
import type {ArrangeContainer, ArrangeHostEvent, ArrangeHostEventListener, ArrangeHostNode} from "./types.ts"

declare global {
    var __ARRANGE_NATIVE__: NativeTransactionTarget | undefined
}

const eventPropNames = new Set(["onUpdate:modelValue", "onUpdate:model-value", "onSubmit", "onChange", "onBlur"])

function isNativePropValue(value: unknown): value is NativePropValue {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function toNativePropValue(key: string, value: unknown): NativePropValue {
    if (eventPropNames.has(key) && typeof value === "function") return value as NativePropValue
    if (isNativePropValue(value)) return value
    throw new TypeError(`Arrange prop '${key}' cannot be sent to native: unsupported value type`)
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
            enqueueNativeMutation(this, (native) => native.setProp?.(this.__arrangeNodeId ?? 0, "modelValue", value))
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

function assignNodeIds(node: ArrangeHostNode | null | undefined, container: ArrangeContainer): void {
    if (!node) return
    if (!node.__arrangeNodeId) node.__arrangeNodeId = container.__arrangeNextNodeId++
    for (const child of node.children ?? []) assignNodeIds(child, container)
}

function emitCreateSubtree(node: ArrangeHostNode | null | undefined, parentId: NodeId | null = null, index = 0, mutations: NativeMutation[] = []): NativeMutation[] {
    if (!node) return mutations
    const id = node.__arrangeNodeId
    if (!id) throw new Error("Arrange host node is missing native node id")
    mutations.push((native) => native.createNode?.(id, String(node.type)))
    for (const [key, value] of Object.entries(node.props ?? {})) {
        if (key === "modifier") continue
        if (key === "text" && node.type === Text) mutations.push((native) => native.setText?.(id, String(value)))
        else mutations.push((native) => native.setProp?.(id, key, toNativePropValue(key, value)))
    }
    mutations.push((native) => native.setModifier?.(id, toModifier(node.props?.modifier ?? m)))
    if (parentId != null) mutations.push((native) => native.insertChild?.(parentId, id, index))
    node.children?.forEach((child, childIndex) => emitCreateSubtree(child, id, childIndex, mutations))
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
    target.beginTransaction?.()
    try {
        for (const mutation of mutations) mutation(target)
    } finally {
        target.endTransaction?.()
    }
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

const renderer = createRenderer<ArrangeHostNode, ArrangeHostNode>({
    patchProp(el, key, _previous, next) {
        if (key === "class" || key === "style") return
        el.props[key] = key === "modifier" ? toModifier(next ?? m) : next
        const id = el.__arrangeNodeId
        if (!id) return
        if (key === "modifier") enqueueNativeMutation(el, (native) => native.setModifier?.(id, toModifier(el.props.modifier ?? m)))
        else if (key === "text" && el.type === Text) enqueueNativeMutation(el, (native) => native.setText?.(id, String(next)))
        else enqueueNativeMutation(el, (native) => native.setProp?.(id, key, toNativePropValue(key, el.props[key])))
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
        const parentId = isHostNode(parent) ? parent.__arrangeNodeId : undefined
        if (container?.__arrangeMounted && parentId) {
            const existingId = child.__arrangeNodeId
            if (!existingId) assignNodeIds(child, container)
            const index = parent.children.indexOf(child)
            enqueueNativeMutation(parent, existingId
                ? (native) => native.insertChild?.(parentId, existingId, index)
                : emitCreateSubtree(child, parentId, index, []))
        }
    },
    remove(child) {
        const parent = child.__arrangeParent
        if (!parent?.children) return
        const parentId = isHostNode(parent) ? parent.__arrangeNodeId : undefined
        const childId = child.__arrangeNodeId
        const index = parent.children.indexOf(child)
        if (index >= 0) parent.children.splice(index, 1)
        child.__arrangeParent = null
        if (parentId && childId) {
            enqueueNativeMutation(parent, [
                (native) => native.removeChild?.(parentId, childId),
                (native) => native.deleteNode?.(childId),
            ])
            clearNodeIds(child)
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
        if (node.__arrangeNodeId) enqueueNativeMutation(node, (native) => native.setText?.(node.__arrangeNodeId ?? 0, String(text)))
    },
    setElementText(node, text) {
        node.children = []
        if (node.type === Text) node.props.text = String(text)
        else if (text !== "") {
            const child = makeTextNode(text)
            child.__arrangeParent = node
            node.children.push(child)
        }
        if (node.__arrangeNodeId) {
            if (node.type === Text) enqueueNativeMutation(node, (native) => native.setText?.(node.__arrangeNodeId ?? 0, String(text)))
            else enqueueNativeMutation(node, (native) => native.invalidate?.(node.__arrangeNodeId ?? 0, "structure", "subtree text replaced"))
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
        container.__arrangeMounted = false
        container.__arrangeNativeFlushPending = false
        target?.beginTransaction?.()
        try {
            target?.unmount?.()
        } finally {
            target?.endTransaction?.()
        }
        container = null
        nativeTarget = null
    }

    app.mount = (target: NativeTransactionTarget = globalThis.__ARRANGE_NATIVE__ ?? {}) => {
        assertNativeRuntime(target)
        nativeTarget = target
        container = {
            $$arrangeContainer: true,
            children: [],
            __arrangeNative: target,
            __arrangeNativeFlushPending: false,
            __arrangeMounted: false,
            __arrangeNextNodeId: 1,
            __arrangePendingMutations: [],
        }
        if (typeof globalThis.Document !== "function") {
            Object.defineProperty(globalThis, "Document", {configurable: true, writable: true, value: function ArrangeDocument() {}})
        }
        if (typeof globalThis.ShadowRoot !== "function") {
            Object.defineProperty(globalThis, "ShadowRoot", {configurable: true, writable: true, value: function ArrangeShadowRoot() {}})
        }
        const result = originalMount(containerAsMountHost(container))
        assignNodeIds(currentTree(container), container)
        container.__arrangeMounted = true
        commitMutations(target, emitCreateSubtree(currentTree(container), null, 0, []))

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
