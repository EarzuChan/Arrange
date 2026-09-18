import type { VNodeProps } from '@arrange/vue-runtime-core'
import type { ValueExpression } from '@arrange/vue-runtime-core'
import type { Modifier } from './modifier.ts'
import type { HorizontalArrangementProp, ResourceRef, TextStyleProp, VerticalArrangementProp } from './native.ts'
import type { BoxAlignment, ContentScaleValue, HorizontalAlignment, ImageAlignment, TextAlignment, VerticalAlignment } from './primitives.ts'

export type HostProps = {
    modifier?: Modifier
    enabled?: boolean
    contentDescription?: string
    label?: string
    description?: string
    role?: string
}

export type BoxProps = HostProps & { contentAlignment?: BoxAlignment }
export type RowProps = HostProps & { horizontalArrangement?: HorizontalArrangementProp; verticalAlignment?: VerticalAlignment | 'Baseline' }
export type ColumnProps = HostProps & { verticalArrangement?: VerticalArrangementProp; horizontalAlignment?: HorizontalAlignment }
export type SpacerProps = HostProps
export type TextProps = HostProps & { text?: string; textStyle?: TextStyleProp; singleLine?: boolean; minLines?: number; maxLines?: number; textAlign?: TextAlignment; overflow?: 'clip' | 'ellipsis' | 'visible' }
export type InputProps = Omit<TextProps, 'text' | 'textAlign' | 'overflow'> & {
    modelValue?: string
    value?: string
    placeholder?: string
    selectAllOnFocus?: boolean
    'onUpdate:modelValue'?: (value: string) => void
    onSubmit?: (value: string) => void
    onChange?: (value: string) => void
    onBlur?: (value: string) => void
}
export type ImageProps = HostProps & { source: ResourceRef; contentScale?: ContentScaleValue; alignment?: ImageAlignment; alpha?: number }
export type IconProps = HostProps & { source: ResourceRef; size?: number; tint?: number }

// 模板与手写 render 共用组件签名，值表达式保持原生输入类型
export type HostComponent<Props> = new () => { $props: { [Key in keyof Props]: Props[Key] | ValueExpression<Props[Key]> } & VNodeProps }
