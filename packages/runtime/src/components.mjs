import {m, toModifier} from "./modifier.mjs"

export const Box = "Box"

export const Row = "Row"

export const Column = "Column"
export const Spacer = "Spacer"
export const Text = "Text"
export const Input = "Input"
export const Image = "Image"
export const Icon = "Icon"
export const Canvas = "Canvas"
export const FlowRow = "FlowRow"
export const FlowColumn = "FlowColumn"
export const LazyColumn = "LazyColumn"
export const LazyRow = "LazyRow"
export const LazyVerticalGrid = "LazyVerticalGrid"
export const LazyHorizontalGrid = "LazyHorizontalGrid"

export function h(type, props = {}, children = []) {
    const normalizedChildren = Array.isArray(children) ? children : (children == null ? [] : [children])

    return Object.freeze({$$arrangeVNode: true, type, props: Object.freeze({...props, modifier: toModifier(props.modifier ?? m)}), children: Object.freeze(normalizedChildren)})
}

export function createApp(root) {
    return {
        root, mount(target = globalThis.__ARRANGE_NATIVE__) {
            const tree = evaluateRoot(root)

            if (target && typeof target.commit === "function") target.commit([{op: "mount", tree}])

            return {tree, unmount() {if (target?.commit) target.commit([{op: "unmount"}])}}
        }
    };
}

export function evaluateRoot(root) {
    if (typeof root === "function") return root()

    if (root && typeof root.render === "function") return root.render()

    if (root && root.$$arrangeVNode) return root

    throw new TypeError("createApp root must be an Arrange VNode, render object, or function")
}
