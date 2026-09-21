import type { HorizontalArrangementProp, VerticalArrangementProp } from './native.ts'
import type { BoxAlignment, HorizontalAlignment, VerticalAlignment } from './primitives.ts'

export type BoxPolicyOptions = Readonly<{ contentAlignment?: BoxAlignment; propagateMinConstraints?: boolean }>
export type RowPolicyOptions = Readonly<{ horizontalArrangement?: HorizontalArrangementProp; verticalAlignment?: VerticalAlignment | 'Baseline' }>
export type ColumnPolicyOptions = Readonly<{ verticalArrangement?: VerticalArrangementProp; horizontalAlignment?: HorizontalAlignment }>
export type MeasurePolicy = Readonly<({ kind: 'Box' } & BoxPolicyOptions) | ({ kind: 'Row' } & RowPolicyOptions) | ({ kind: 'Column' } & ColumnPolicyOptions) | { kind: 'MinSize' }>

const policies = new WeakSet<object>()

function policy<T extends MeasurePolicy>(value: T): T {
    for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key]
    policies.add(value)
    return Object.freeze(value)
}

export function isMeasurePolicy(value: unknown): value is MeasurePolicy {
    return typeof value === 'object' && value !== null && policies.has(value)
}

export function BoxMeasurePolicy(options: BoxPolicyOptions = {}): MeasurePolicy {
    return policy({ kind: 'Box', ...options })
}

export function RowMeasurePolicy(options: RowPolicyOptions = {}): MeasurePolicy {
    return policy({ kind: 'Row', ...options, horizontalArrangement: freezeArrangement(options.horizontalArrangement) })
}

export function ColumnMeasurePolicy(options: ColumnPolicyOptions = {}): MeasurePolicy {
    return policy({ kind: 'Column', ...options, verticalArrangement: freezeArrangement(options.verticalArrangement) })
}

function freezeArrangement<T extends HorizontalArrangementProp | VerticalArrangementProp | undefined>(value: T): T {
    return (value && typeof value === 'object' ? Object.freeze(value.alignment === undefined ? { kind: value.kind, space: value.space } : { ...value }) : value) as T
}

export const MinSizeMeasurePolicy: MeasurePolicy = policy({ kind: 'MinSize' })