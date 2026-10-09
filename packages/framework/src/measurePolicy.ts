import type { HorizontalArrangementProp, VerticalArrangementProp } from './native.ts'
import type { BoxAlignment, HorizontalAlignment, VerticalAlignment, GridCellsValue, Padding } from './primitives.ts'

export type BoxPolicyOptions = Readonly<{ contentAlignment?: BoxAlignment; propagateMinConstraints?: boolean }>
export type RowPolicyOptions = Readonly<{ horizontalArrangement?: HorizontalArrangementProp; verticalAlignment?: VerticalAlignment | 'Baseline' }>
export type ColumnPolicyOptions = Readonly<{ verticalArrangement?: VerticalArrangementProp; horizontalAlignment?: HorizontalAlignment }>
export type FlowRowPolicyOptions = Readonly<{ horizontalArrangement?: HorizontalArrangementProp; verticalArrangement?: VerticalArrangementProp; itemVerticalAlignment?: VerticalAlignment; maxItemsInEachRow?: number }>
export type FlowColumnPolicyOptions = Readonly<{ verticalArrangement?: VerticalArrangementProp; horizontalArrangement?: HorizontalArrangementProp; itemHorizontalAlignment?: HorizontalAlignment; maxItemsInEachColumn?: number }>
export type LazyPolicyOptions = Readonly<{
    horizontal: boolean; grid: boolean; cells: GridCellsValue; horizontalArrangement?: HorizontalArrangementProp; verticalArrangement?: VerticalArrangementProp
    itemAlignment?: HorizontalAlignment | VerticalAlignment; contentPadding: Padding
    keys: readonly string[]; contentTypes: readonly string[]; spans: readonly number[]; indices: readonly number[]; pinnedIndices: readonly number[]
    version: number; workVersion: number; requestVersion: number; requestedIndex: number; requestedOffset: number
}>
export type MeasurePolicy = Readonly<({ kind: 'Box' } & BoxPolicyOptions) | ({ kind: 'Row' } & RowPolicyOptions) | ({ kind: 'Column' } & ColumnPolicyOptions) | ({ kind: 'FlowRow' } & FlowRowPolicyOptions) | ({ kind: 'FlowColumn' } & FlowColumnPolicyOptions) | { kind: 'MinSize' } | ({ kind: 'Lazy' } & LazyPolicyOptions)>

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
    return (value && typeof value === 'object' ? Object.freeze(value.alignment === undefined ? { kind: value.kind, spaceDp: value.spaceDp, spacePx: value.spacePx } : { ...value }) : value) as T
}

export const MinSizeMeasurePolicy: MeasurePolicy = policy({ kind: 'MinSize' })

function flowCount(value: number | undefined): number | undefined {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)) throw new RangeError('Flow 每行数量必须是正整数且不超过 2147483647')
    return value
}

export function FlowRowMeasurePolicy(options: FlowRowPolicyOptions = {}): MeasurePolicy {
    return policy({ kind: 'FlowRow', ...options, horizontalArrangement: freezeArrangement(options.horizontalArrangement), verticalArrangement: freezeArrangement(options.verticalArrangement), maxItemsInEachRow: flowCount(options.maxItemsInEachRow) })
}

export function FlowColumnMeasurePolicy(options: FlowColumnPolicyOptions = {}): MeasurePolicy {
    return policy({ kind: 'FlowColumn', ...options, horizontalArrangement: freezeArrangement(options.horizontalArrangement), verticalArrangement: freezeArrangement(options.verticalArrangement), maxItemsInEachColumn: flowCount(options.maxItemsInEachColumn) })
}

export function LazyMeasurePolicy(options: LazyPolicyOptions): MeasurePolicy {
    return policy({ kind: 'Lazy', ...options, horizontalArrangement: freezeArrangement(options.horizontalArrangement), verticalArrangement: freezeArrangement(options.verticalArrangement) })
}
