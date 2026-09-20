import { arrangeValue, defineFoundationArrangable } from '@arrange/vue-runtime-core'
import type { Arrangable, PropType } from '@arrange/vue-runtime-core'
import { BoxMeasurePolicy, ColumnMeasurePolicy, MinSizeMeasurePolicy, RowMeasurePolicy, TextMeasurePolicy, isMeasurePolicy } from './measurePolicy.ts'
import type { MeasurePolicy } from './measurePolicy.ts'
import { M, Modifier } from './modifier.ts'
import { isPainter } from './painter.ts'
import type { HorizontalArrangementProp, Painter, TextStyleProp, VerticalArrangementProp } from './native.ts'
import type { BoxAlignment, ContentScaleValue, HorizontalAlignment, ImageAlignment, TextAlignment, VerticalAlignment } from './primitives.ts'

export type LayoutProps = InstanceType<typeof Layout>['$props']
export const Layout = defineFoundationArrangable({
    name: 'Layout',
    props: { modifier: { type: Modifier, default: M }, measurePolicy: { type: Object as PropType<MeasurePolicy>, required: true, validator: isMeasurePolicy }, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],

})

export type BoxProps = InstanceType<typeof Box>['$props']
export const Box = defineFoundationArrangable({
    name: 'Box',
    props: { modifier: { type: Modifier, default: M }, contentAlignment: String as PropType<BoxAlignment>, propagateMinConstraints: Boolean, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],
    implement: ({ props, call, slot, source }) => call(Layout, {
        measurePolicy: arrangeValue(() => BoxMeasurePolicy({ contentAlignment: props.contentAlignment, propagateMinConstraints: props.propagateMinConstraints })),
        modifier: arrangeValue(() => props.modifier, source('modifier')),
        enabled: arrangeValue(() => props.enabled, source('enabled')),
        contentDescription: arrangeValue(() => props.contentDescription, source('contentDescription')),
    }, { default: slot('default') }),
})

export type RowProps = InstanceType<typeof Row>['$props']
export const Row = defineFoundationArrangable({
    name: 'Row',
    props: { modifier: { type: Modifier, default: M }, horizontalArrangement: [String, Object] as PropType<HorizontalArrangementProp>, verticalAlignment: String as PropType<VerticalAlignment | 'Baseline'> },
    slotNames: ['default'],
    implement: ({ props, call, slot, source }) => call(Layout, {
        measurePolicy: arrangeValue(() => RowMeasurePolicy({ horizontalArrangement: props.horizontalArrangement, verticalAlignment: props.verticalAlignment })),
        modifier: arrangeValue(() => props.modifier, source('modifier')),
    }, { default: slot('default') }),
})

export type ColumnProps = InstanceType<typeof Column>['$props']
export const Column = defineFoundationArrangable({
    name: 'Column',
    props: { modifier: { type: Modifier, default: M }, verticalArrangement: [String, Object] as PropType<VerticalArrangementProp>, horizontalAlignment: String as PropType<HorizontalAlignment> },
    slotNames: ['default'],
    implement: ({ props, call, slot, source }) => call(Layout, {
        measurePolicy: arrangeValue(() => ColumnMeasurePolicy({ verticalArrangement: props.verticalArrangement, horizontalAlignment: props.horizontalAlignment })),
        modifier: arrangeValue(() => props.modifier, source('modifier')),
    }, { default: slot('default') }),
})

export type SpacerProps = InstanceType<typeof Spacer>['$props']
export const Spacer = defineFoundationArrangable({
    name: 'Spacer',
    props: { modifier: { type: Modifier, default: M } },
    slotNames: [],
    implement: ({ props, call, source }) => call(Layout, { measurePolicy: MinSizeMeasurePolicy, modifier: arrangeValue(() => props.modifier, source('modifier')) }),
})

export type TextProps = InstanceType<typeof Text>['$props']
export const Text = defineFoundationArrangable({
    name: 'Text',
    props: { modifier: { type: Modifier, default: M }, textStyle: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, text: { type: String, default: '' }, textAlign: String as PropType<TextAlignment>, overflow: String as PropType<'clip' | 'ellipsis' | 'visible'> },
    slotNames: [],

})

export type InputProps = InstanceType<typeof Input>['$props']
export const Input = defineFoundationArrangable({
    name: 'Input',
    props: { modifier: { type: Modifier, default: M }, enabled: Boolean, textStyle: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, value: { type: String, default: '' }, placeholder: String, selectAllOnFocus: Boolean, onValueChange: Function as PropType<(value: string) => void>, onSubmit: Function as PropType<(value: string) => void>, onChange: Function as PropType<(value: string) => void>, onBlur: Function as PropType<(value: string) => void> },
    slotNames: [],

})

export type ImageProps = InstanceType<typeof Image>['$props']
export const Image = defineFoundationArrangable({
    name: 'Image',
    props: { modifier: { type: Modifier, default: M }, painter: { type: Object as PropType<Painter>, required: true, validator: isPainter }, contentScale: String as PropType<ContentScaleValue>, alignment: String as PropType<ImageAlignment>, alpha: Number, contentDescription: String },
    slotNames: [],
    implement: ({ props, call, source }) => call(Layout, {
        measurePolicy: MinSizeMeasurePolicy,
        modifier: arrangeValue(() => props.modifier.paint(props.painter, { contentScale: props.contentScale, alignment: props.alignment, alpha: props.alpha }), source('painter')),
        contentDescription: arrangeValue(() => props.contentDescription, source('contentDescription')),
    }),
})

export type IconProps = InstanceType<typeof Icon>['$props']
export const Icon = defineFoundationArrangable({
    name: 'Icon',
    props: { modifier: { type: Modifier, default: M }, painter: { type: Object as PropType<Painter>, required: true, validator: isPainter }, tint: Number, contentDescription: String },
    slotNames: [],
    implement: ({ props, call, source }) => call(Box, {
        modifier: arrangeValue(() => props.modifier.paint(props.painter, { colorFilter: props.tint === undefined ? undefined : { tint: props.tint } }), source('painter')),
        contentDescription: arrangeValue(() => props.contentDescription, source('contentDescription')),
    }),
})

export const DynamicArrangable = defineFoundationArrangable({
    name: 'DynamicArrangable',
    props: { is: { type: Object as PropType<Arrangable>, required: true }, props: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) } },
    slotNames: [],
    implement: ({ props, call, source }) => call(props.is, props.props),
})

export const foundationArrangables = { Layout, Box, Row, Column, Spacer, Text, Input, Image, Icon, DynamicArrangable }
