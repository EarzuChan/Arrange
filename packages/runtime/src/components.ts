import { defineComponent, h } from "@arrange/vue-runtime-core"
import { useContentColor } from "./local.ts"
import type { BoxProps, RowProps, ColumnProps, SpacerProps, TextProps, InputProps, ImageProps, IconProps, HostComponent } from './componentTypes.ts'

export const Box = "Box" as unknown as HostComponent<BoxProps>

export const Row = "Row" as unknown as HostComponent<RowProps>

export const Column = "Column" as unknown as HostComponent<ColumnProps>

export const Spacer = "Spacer" as unknown as HostComponent<SpacerProps>

export const Text = "Text" as unknown as HostComponent<TextProps>

export const Input = "Input" as unknown as HostComponent<InputProps>

export const Image = "Image" as unknown as HostComponent<ImageProps>

export const Icon = defineComponent({
    name: "Icon",
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
        const contentColor = useContentColor()

        return () => h("Icon", {
            ...attrs,
            tint: attrs.tint == null ? contentColor : attrs.tint,
        }, slots.default?.())
    },
}) as unknown as HostComponent<IconProps>
