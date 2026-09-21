import { defineArrangable, shallowRef, watch } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { MinSizeMeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import type { TextStyleProp } from '../native.ts'
import type { TextAlignment } from '../primitives.ts'
import { Layout } from './Layout.ts'

export type TextProps = ArrangableProps<typeof Text>
export const Text = defineArrangable({
    name: 'Text',
    props: { modifier: { type: Modifier, default: M }, style: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, text: { type: String, default: '' }, textAlign: String as PropType<TextAlignment>, overflow: String as PropType<'clip' | 'ellipsis' | 'visible'> },
    slotNames: [],
    setup: (props, { call, source }) => () => call(0, Layout, {
        measurePolicy: () => MinSizeMeasurePolicy,
        modifier: () => props.modifier.text(props.text, { style: props.style, singleLine: props.singleLine, minLines: props.minLines, maxLines: props.maxLines, textAlign: props.textAlign, overflow: props.overflow }),
    }, {}, { sources: { modifier: source('text') } }),
})

export type InputProps = ArrangableProps<typeof Input>
export const Input = defineArrangable({
    name: 'Input',
    props: { modifier: { type: Modifier, default: M }, enabled: Boolean, textStyle: Object as PropType<TextStyleProp>, singleLine: Boolean, minLines: Number, maxLines: Number, value: { type: String, default: '' }, placeholder: String, selectAllOnFocus: Boolean, onValueChange: Function as PropType<(value: string) => void>, onSubmit: Function as PropType<(value: string) => void>, onChange: Function as PropType<(value: string) => void>, onBlur: Function as PropType<(value: string) => void> },
    slotNames: [],
    setup(props, { call, source }) {
        // 编辑值归属逻辑实例，停用时原生实体退休也不会丢失未绑定的文本
        const value = shallowRef(props.value)
        watch(() => props.value, next => { value.value = next }, { flush: 'sync' })
        const edited = (next: string) => {
            value.value = next
            props.onValueChange?.(next)
        }
        return () => call(0, Layout, {
            measurePolicy: () => MinSizeMeasurePolicy,
            modifier: () => props.modifier.textField(value.value, { textStyle: props.textStyle, singleLine: props.singleLine, minLines: props.minLines, maxLines: props.maxLines, placeholder: props.placeholder, enabled: props.enabled, selectAllOnFocus: props.selectAllOnFocus, onValueChange: edited, onSubmit: props.onSubmit, onChange: props.onChange, onBlur: props.onBlur }),
            enabled: () => props.enabled,
        }, {}, { sources: { modifier: source('value'), enabled: source('enabled') } })
    },
})
