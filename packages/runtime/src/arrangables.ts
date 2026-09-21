import { currentInstance } from '@arrange/vue-runtime-core/internal'
import { ValueBinding } from '@arrange/vue-runtime-core/internal'
import { invokeContent } from '@arrange/vue-runtime-core/internal'
import { LayoutRearrangeNode, NativeComposition } from './rearrangeNode.ts'
import { defineArrangable } from '@arrange/vue-runtime-core'
import type { Arrangable, ArrangableProps, PropType } from '@arrange/vue-runtime-core'
import { BoxMeasurePolicy, ColumnMeasurePolicy, MinSizeMeasurePolicy, RowMeasurePolicy, isMeasurePolicy } from './measurePolicy.ts'
import type { MeasurePolicy } from './measurePolicy.ts'
import { M, Modifier } from './modifier.ts'
import { isPainter } from './painter.ts'
import type { HorizontalArrangementProp, Painter, TextStyleProp, VerticalArrangementProp } from './native.ts'
import type { BoxAlignment, ContentScaleValue, HorizontalAlignment, ImageAlignment, TextAlignment, VerticalAlignment } from './primitives.ts'
import { retainContent } from '@arrange/vue-runtime-core/internal'
import type { RearrangeKey } from '@arrange/vue-runtime-core/internal'

export type LayoutProps = ArrangableProps<typeof Layout>
export const Layout = defineArrangable({
    name: 'Layout',
    props: { modifier: { type: Modifier, default: M }, measurePolicy: { type: Object as PropType<MeasurePolicy>, required: true, validator: isMeasurePolicy }, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],
    setup(props, { slot, source }) {
        const instance = currentInstance!

        // TIPS：唯一真豪组件，可以直撅NativeComposition
        const host = instance.appContext.host
        if (!(host instanceof NativeComposition)) throw new Error('Layout 需要正式原生应用宿主')

        const node = new LayoutRearrangeNode(instance, host)
        instance.node = node

        new ValueBinding(() => props.measurePolicy, instance, value => node.updateMeasurePolicy(value as MeasurePolicy), source('measurePolicy'))
        new ValueBinding(() => props.modifier, instance, value => node.updateModifier(value as Modifier), source('modifier'))
        new ValueBinding(() => props.enabled, instance, value => node.updateInput('enabled', value as boolean | undefined), source('enabled'))
        new ValueBinding(() => props.contentDescription, instance, value => node.updateInput('contentDescription', value as string | undefined), source('contentDescription'))

        const content = slot()
        return () => invokeContent(0, content)
    },
})

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

export type TextProps = ArrangableProps<typeof Text>
export const Text = defineArrangable({
    name: 'Text',
    props: { modifier: { type: Modifier, default: M }, textStyle: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, text: { type: String, default: '' }, textAlign: String as PropType<TextAlignment>, overflow: String as PropType<'clip' | 'ellipsis' | 'visible'> },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Layout, {
        measurePolicy: () => MinSizeMeasurePolicy,
        modifier: () => props.modifier.text(props.text, { textStyle: props.textStyle, singleLine: props.singleLine, minLines: props.minLines, maxLines: props.maxLines, textAlign: props.textAlign, overflow: props.overflow }),
    }, {}, { sources: { modifier: source('text') } }),
})

export type InputProps = ArrangableProps<typeof Input>
export const Input = defineArrangable({
    name: 'Input',
    props: { modifier: { type: Modifier, default: M }, enabled: Boolean, textStyle: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, value: { type: String, default: '' }, placeholder: String, selectAllOnFocus: Boolean, onValueChange: Function as PropType<(value: string) => void>, onSubmit: Function as PropType<(value: string) => void>, onChange: Function as PropType<(value: string) => void>, onBlur: Function as PropType<(value: string) => void> },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Layout, {
        measurePolicy: () => MinSizeMeasurePolicy,
        modifier: () => props.modifier.textField(props.value, { textStyle: props.textStyle, singleLine: props.singleLine, minLines: props.minLines, maxLines: props.maxLines, placeholder: props.placeholder, enabled: props.enabled, selectAllOnFocus: props.selectAllOnFocus, onValueChange: props.onValueChange, onSubmit: props.onSubmit, onChange: props.onChange, onBlur: props.onBlur }),
        enabled: () => props.enabled,
    }, {}, { sources: { modifier: source('value'), enabled: source('enabled') } }),
})

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

export const DynamicArrangable = defineArrangable({
    name: 'DynamicArrangable',
    props: { is: { type: Object as PropType<Arrangable>, required: true }, props: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) } },
    slotNames: [],
    setup: (props, { call }) => () => call(0, props.is, Object.fromEntries(Object.keys(props.props).map(name => [name, () => props.props[name]]))),
})

export type KeepAliveProps = ArrangableProps<typeof KeepAlive>
export const KeepAlive = defineArrangable({ // 这个没被导出在foundationArrangables？
    name: 'KeepAlive',
    props: { cacheKey: { type: [String, Number, Symbol, BigInt, null] as PropType<RearrangeKey>, required: true }, max: Number },
    slotNames: ['default'],
    setup(props, { slot }) {
        const content = slot()
        return () => retainContent(0, props.cacheKey, content, props.max)
    },
})

export const foundationArrangables = { Layout, Box, Row, Column, Spacer, Text, Input, Image, Icon, DynamicArrangable }
