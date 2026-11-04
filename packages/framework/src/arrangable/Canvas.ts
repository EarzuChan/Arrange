import { defineArrangable } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { isCanvasController, type CanvasController, type CanvasInvalidation, type DrawCallback } from '../draw.ts'
import { M, Modifier, canvasModifier } from '../modifier.ts'
import { Box } from './LayoutingArrangables.ts'

// Canvas：一个绘制节点，onDraw 与绘制修饰器共用 DrawScope；尺寸由 modifier 决定，没有固有尺寸
export type CanvasProps = ArrangableProps<typeof Canvas>
export const Canvas = defineArrangable({
    name: 'Canvas',
    props: {
        modifier: { type: Modifier, default: M },
        invalidation: { type: String as PropType<CanvasInvalidation>, default: 'auto', validator: (value: unknown) => value === 'auto' || value === 'manual' || value === 'frame' },
        controller: { type: Object as PropType<CanvasController>, validator: isCanvasController },
        onDraw: { type: Function as PropType<DrawCallback>, required: true },
    },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Box, {
        modifier: () => canvasModifier(props.modifier, props.onDraw, props.invalidation, props.controller),
    }, {}, { sources: { modifier: source('modifier') ?? source('onDraw') } }),
})
