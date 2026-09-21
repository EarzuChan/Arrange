import { defineArrangable } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { MinSizeMeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import { isPainter } from '../painter.ts'
import type { Painter } from '../native.ts'
import type { ContentScaleValue, ImageAlignment } from '../primitives.ts'
import { Layout } from './Layout.ts'
import { Box } from './LayoutingArrangables.ts'

export type ImageProps = ArrangableProps<typeof Image>
export const Image = defineArrangable({
    name: 'Image',
    props: { modifier: { type: Modifier, default: M }, painter: { type: Object as PropType<Painter>, required: true, validator: isPainter }, contentScale: String as PropType<ContentScaleValue>, alignment: String as PropType<ImageAlignment>, alpha: Number, contentDescription: String },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Layout, {
        measurePolicy: () => MinSizeMeasurePolicy,
        modifier: () => props.modifier.paint(props.painter, { contentScale: props.contentScale, alignment: props.alignment, alpha: props.alpha }),
        contentDescription: () => props.contentDescription,
    }, {}, { sources: { modifier: source('modifier'), contentDescription: source('contentDescription') } }),
})

export type IconProps = ArrangableProps<typeof Icon>
export const Icon = defineArrangable({
    name: 'Icon',
    props: { modifier: { type: Modifier, default: M }, painter: { type: Object as PropType<Painter>, required: true, validator: isPainter }, tint: Number, contentDescription: String },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Box, {
        modifier: () => props.modifier.paint(props.painter, { colorFilter: props.tint === undefined ? undefined : { tint: props.tint } }),
        contentDescription: () => props.contentDescription,
    }, {}, { sources: { modifier: source('modifier'), contentDescription: source('contentDescription') } }),
})