import { defineArrangable } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { BoxMeasurePolicy, ColumnMeasurePolicy, MinSizeMeasurePolicy, RowMeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import type { HorizontalArrangementProp, VerticalArrangementProp } from '../native.ts'
import type { BoxAlignment, HorizontalAlignment, VerticalAlignment } from '../primitives.ts'
import { Layout } from './Layout.ts'

export type BoxProps = ArrangableProps<typeof Box>
export const Box = defineArrangable({
    name: 'Box',
    props: { modifier: { type: Modifier, default: M }, contentAlignment: String as PropType<BoxAlignment>, propagateMinConstraints: Boolean, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],
    setup: (props, { call, slot, source }) => () => call(0, Layout, {
        measurePolicy: () => BoxMeasurePolicy({ contentAlignment: props.contentAlignment, propagateMinConstraints: props.propagateMinConstraints }),
        modifier: () => props.modifier,
        enabled: () => props.enabled,
        contentDescription: () => props.contentDescription,
    }, { default: slot('default') }, { sources: { modifier: source('modifier'), measurePolicy: source('contentAlignment') ?? source('propagateMinConstraints'), enabled: source('enabled'), contentDescription: source('contentDescription') } }),
})

export type RowProps = ArrangableProps<typeof Row>
export const Row = defineArrangable({
    name: 'Row',
    props: { modifier: { type: Modifier, default: M }, horizontalArrangement: [String, Object] as PropType<HorizontalArrangementProp>, verticalAlignment: String as PropType<VerticalAlignment | 'Baseline'> },
    slotNames: ['default'],
    setup: (props, { call, slot, source }) => () => call(0, Layout, {
        measurePolicy: () => RowMeasurePolicy({ horizontalArrangement: props.horizontalArrangement, verticalAlignment: props.verticalAlignment }),
        modifier: () => props.modifier,
    }, { default: slot('default') }, { sources: { modifier: source('modifier'), measurePolicy: source('horizontalArrangement') ?? source('verticalAlignment') } }),
})

export type ColumnProps = ArrangableProps<typeof Column>
export const Column = defineArrangable({
    name: 'Column',
    props: { modifier: { type: Modifier, default: M }, verticalArrangement: [String, Object] as PropType<VerticalArrangementProp>, horizontalAlignment: String as PropType<HorizontalAlignment> },
    slotNames: ['default'],
    setup: (props, { call, slot, source }) => () => call(0, Layout, {
        measurePolicy: () => ColumnMeasurePolicy({ verticalArrangement: props.verticalArrangement, horizontalAlignment: props.horizontalAlignment }),
        modifier: () => props.modifier,
    }, { default: slot('default') }, { sources: { modifier: source('modifier'), measurePolicy: source('verticalArrangement') ?? source('horizontalAlignment') } }),
})

export type SpacerProps = ArrangableProps<typeof Spacer>
export const Spacer = defineArrangable({
    name: 'Spacer',
    props: { modifier: { type: Modifier, default: M } },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => props.modifier }, {}, { sources: { modifier: source('modifier') } }),
})