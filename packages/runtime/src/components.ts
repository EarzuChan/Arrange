import {defineComponent, h} from "@arrange/vue-runtime-core"
import {useContentColor} from "./local.ts"

export const Box = "Box"
export const Row = "Row"
export const Column = "Column"
export const Spacer = "Spacer"
export const Text = "Text"
export const Input = "Input"
export const Image = "Image"
export const Icon = defineComponent({
    name: "Icon",
    inheritAttrs: false,
    setup(_props, {attrs, slots}) {
        const contentColor = useContentColor()
        return () => h("Icon", {
            ...attrs,
            tint: attrs.tint == null ? contentColor : attrs.tint,
        }, slots.default?.())
    },
})
export const Canvas = "Canvas"
export const FlowRow = "FlowRow"
export const FlowColumn = "FlowColumn"
export const LazyColumn = "LazyColumn"
export const LazyRow = "LazyRow"
export const LazyVerticalGrid = "LazyVerticalGrid"
export const LazyHorizontalGrid = "LazyHorizontalGrid"
