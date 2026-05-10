import {__arrangeSetFocusManager} from "../state.ts"
import {collectDrawOps, renderVNode} from "./headlessLayout.ts"
import type {DrawOp, MeasuredNode} from "./headlessLayout.ts"
import type {ArrangeElementVNode, ArrangeHostProps, ArrangeVNode} from "../types.ts"

type HeadlessRenderOptions = Parameters<typeof renderVNode>[1]
type Bounds = {x: number; y: number; width: number; height: number}
type KeyName = "Enter" | "Space" | " " | string

export function h(type: string, props: ArrangeHostProps = {}, children: ArrangeChildInput = []): ArrangeElementVNode {
    return {
        $$arrangeVNode: true,
        type,
        props: props ?? {},
        children: Array.isArray(children) ? children : [children],
    }
}

export {renderToBridgeBatch, renderToBridgeOps} from "../renderer.ts"

type ArrangeChildInput = ArrangeVNode | ArrangeVNode[]
type ArrangeRootInput = ArrangeVNode | (() => ArrangeVNode)

export async function renderArrange(root: ArrangeRootInput, options: HeadlessRenderOptions = {}): Promise<HeadlessArrangeTree> {
    const vnode = typeof root === "function" ? root() : root
    const measured = renderVNode(vnode, options)
    const focusManager = new HeadlessFocusManager(measured)
    __arrangeSetFocusManager(focusManager)
    bindFocusRequesters(measured, focusManager)
    return new HeadlessArrangeTree(measured, focusManager)
}

class HeadlessArrangeTree {
    readonly tree: MeasuredNode
    readonly focusManager: HeadlessFocusManager

    constructor(tree: MeasuredNode, focusManager: HeadlessFocusManager) {
        this.tree = tree
        this.focusManager = focusManager
    }

    node(tag: string): HeadlessArrangeNode {
        const found = findByTag(this.tree, tag)
        if (!found) throw new Error(`Arrange test node not found: ${tag}`)
        return new HeadlessArrangeNode(found, this.focusManager)
    }

    snapshot(): {bounds: Bounds} {
        return {bounds: boundsOf(this.tree)}
    }

    drawOps(): DrawOp[] {
        return collectDrawOps(this.tree)
    }

    performKey(key: KeyName): boolean {
        return this.focusManager.performKey(key)
    }
}

class HeadlessArrangeNode {
    readonly node: MeasuredNode
    readonly focusManager: HeadlessFocusManager

    constructor(node: MeasuredNode, focusManager: HeadlessFocusManager) {
        this.node = node
        this.focusManager = focusManager
    }

    bounds(): Bounds {
        return boundsOf(this.node)
    }

    baseline(): number {
        return this.node.baseline ?? -1
    }

    performClick(): boolean {
        if (!this.node.clickable || this.node.clickable.enabled === false) return false
        this.requestFocus()
        const onClick = this.node.clickable.onClick
        if (typeof onClick === "function") onClick()
        return true
    }

    performHoverEnter(): boolean {
        if (!this.node.hoverable || this.node.hoverable.enabled === false) return false
        if (this.node.interactionState) this.node.interactionState.hovered = true
        const onEnter = this.node.hoverable.onEnter
        if (typeof onEnter === "function") onEnter()
        return true
    }

    performHoverExit(): boolean {
        if (!this.node.hoverable || this.node.hoverable.enabled === false) return false
        if (this.node.interactionState) this.node.interactionState.hovered = false
        const onExit = this.node.hoverable.onExit
        if (typeof onExit === "function") onExit()
        return true
    }

    requestFocus(): boolean {
        return this.focusManager.requestFocus(this.node)
    }

    isFocused(): boolean {
        return this.focusManager.focused === this.node
    }
}

class HeadlessFocusManager {
    readonly root: MeasuredNode
    focused: MeasuredNode | null

    constructor(root: MeasuredNode) {
        this.root = root
        this.focused = null
    }

    requestFocus(node: MeasuredNode): boolean {
        if (!node.focusable) return false
        if (this.focused === node) return true
        if (this.focused) setFocused(this.focused, false)
        this.focused = node
        setFocused(node, true)
        return true
    }

    clearFocus(): boolean {
        if (!this.focused) return false
        setFocused(this.focused, false)
        this.focused = null
        return true
    }

    performKey(key: KeyName): boolean {
        if (!this.focused?.clickable) return false
        if (key !== "Enter" && key !== "Space" && key !== " ") return false
        const onClick = this.focused.clickable.onClick
        if (typeof onClick === "function") onClick()
        return true
    }
}

function bindFocusRequesters(node: MeasuredNode, focusManager: HeadlessFocusManager): void {
    if (node.focusRequester?.__arrangeBind) node.focusRequester.__arrangeBind(() => focusManager.requestFocus(node))
    for (const child of node.children ?? []) bindFocusRequesters(child, focusManager)
}

function setFocused(node: MeasuredNode, focused: boolean): void {
    if (node.interactionState) node.interactionState.focused = focused
    node.onFocusChanged?.({focused})
}

function findByTag(node: MeasuredNode, tag: string): MeasuredNode | null {
    if (node.tags?.includes(tag)) return node
    for (const child of node.children ?? []) {
        const found = findByTag(child, tag)
        if (found) return found
    }
    return null
}

function boundsOf(node: MeasuredNode): Bounds {
    return {x: node.x, y: node.y, width: node.width, height: node.height}
}
