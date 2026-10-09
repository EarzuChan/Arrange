import { unitFieldContracts, type UnitFields } from '@arrange/shared'
import type { Density } from './density.ts'
import type { Modifier, ModifierElement } from './modifier.ts'
import type { MeasurePolicy } from './measurePolicy.ts'
import type { ArrangementProp } from './native.ts'
import { DrawInstance, type DrawDeclaration } from './draw.ts'
import type { ArrangableInstance } from './runtime/internal.ts'

export interface PxModifier {
    readonly elements: readonly ModifierElement[]
}

// 每个 Layout 在这里把 SFA/TS 的双通道长度表达式求成 native 使用的 PX 数字
export class UnitResolver {
    private previous: PxModifier | undefined
    private policy: MeasurePolicy | undefined
    private draws: readonly { index: number; instance: DrawInstance }[] = []

    constructor(private readonly density: Density, private readonly owner?: ArrangableInstance) { }

    modifier(declaration: Modifier): PxModifier {
        const previousDraws = this.draws
        const previousModifier = this.previous
        const draws: { index: number; instance: DrawInstance }[] = []
        const used = new Set<DrawInstance>()
        const matched = new Set<number>()
        let cursor = 0
        const elements = declaration.elements.map((element, index) => {
            const input = element.value
            let match = -1
            if (element.key) match = previousModifier?.elements.findIndex((old, at) => !matched.has(at) && old.key === element.key && old.type === element.type) ?? -1
            else if (previousModifier) for (let at = cursor; at < previousModifier.elements.length; at++) {
                const old = previousModifier.elements[at]
                if (!matched.has(at) && !old.key && old.type === element.type) {
                    match = at
                    cursor = at + 1
                    break
                }
            }
            if (match >= 0) matched.add(match)
            if (element.type === 'drawBehind' || element.type === 'drawWithContent' || element.type === 'drawWithCache') {
                const retained = previousDraws.find(item => item.index === match)?.instance
                const instance = retained && retained.declaration.draw === input.draw ? retained : new DrawInstance(element.type, input as DrawDeclaration, this.owner)
                used.add(instance)
                draws.push({ index, instance })
                const value = Object.freeze({ prepare: instance.prepare, revision: instance.revision.value, transactional: true })
                const previous = this.previous?.elements[index]
                return previous && previous.type === element.type && previous.key === element.key && sameValue(previous.value, value) ? previous : Object.freeze({ ...element, value })
            }
            const styleField = element.type === 'text' ? 'style' : element.type === 'textField' ? 'textStyle' : undefined
            const styled = styleField ? { ...input, [styleField]: { fontSize: 14, lineHeight: 0, ...input[styleField] as object } } : input
            const value = this.resolveModifierValue(element.type, styled)
            const previous = this.previous?.elements[index]
            if (previous && previous.type === element.type && previous.key === element.key && sameValue(previous.value, value)) return previous
            return value === element.value && !styleField ? element : Object.freeze({ ...element, value })
        })

        this.draws = draws
        const removed = previousDraws.filter(item => !used.has(item.instance))
        const created = draws.filter(item => !previousDraws.some(old => old.instance === item.instance))
        const session = this.owner?.rearrangeSession
        if (session?.preparing) {
            session.onCommit(() => { for (const item of removed) item.instance.stop() })
            session.onRollback(() => {
                for (const item of created) item.instance.stop()
                this.draws = previousDraws
                this.previous = previousModifier
            })
        } else for (const item of removed) item.instance.stop()

        if (this.previous && elements.length === this.previous.elements.length && elements.every((element, index) => element === this.previous!.elements[index])) return this.previous
        return this.previous = Object.freeze({ elements: Object.freeze(elements) })
    }

    measurePolicy(declaration: MeasurePolicy): MeasurePolicy {
        if (declaration.kind === 'Lazy') {
            const spacing = (value: any) => value && typeof value === 'object' ? this.resolveLength(value.spaceDp, value.spacePx) : 0
            const padding = declaration.contentPadding
            const horizontal = declaration.horizontal
            const value = Object.freeze({
                kind: 'Lazy', horizontal, grid: declaration.grid,
                cells: declaration.cells.type === 'Fixed' ? declaration.cells.count : 1,
                adaptiveMinSize: declaration.cells.type === 'Adaptive' ? this.resolveLength(declaration.cells.minSizeDp, declaration.cells.minSizePx) : 0,
                mainSpacing: spacing(horizontal ? declaration.horizontalArrangement : declaration.verticalArrangement),
                crossSpacing: spacing(horizontal ? declaration.verticalArrangement : declaration.horizontalArrangement),
                mainAlignment: (() => {
                    const value = horizontal ? declaration.horizontalArrangement : declaration.verticalArrangement
                    return typeof value === 'string' ? value : value?.alignment ?? (horizontal ? 'Start' : 'Top')
                })(),
                crossBeforePadding: this.resolveLength(horizontal ? padding.topDp : padding.startDp, horizontal ? padding.topPx : padding.startPx),
                crossAfterPadding: this.resolveLength(horizontal ? padding.bottomDp : padding.endDp, horizontal ? padding.bottomPx : padding.endPx),
                beforePadding: this.resolveLength(horizontal ? padding.startDp : padding.topDp, horizontal ? padding.startPx : padding.topPx),
                afterPadding: this.resolveLength(horizontal ? padding.endDp : padding.bottomDp, horizontal ? padding.endPx : padding.bottomPx),
                estimate: this.density.dpToPx(48), itemAlignment: declaration.itemAlignment ?? (horizontal ? 'Top' : 'Start'),
                version: declaration.version, workVersion: declaration.workVersion, requestVersion: declaration.requestVersion, requestedIndex: declaration.requestedIndex, requestedOffset: declaration.requestedOffset,
                keys: declaration.keys, contentTypes: declaration.contentTypes, spans: declaration.spans, indices: declaration.indices, pinnedIndices: declaration.pinnedIndices,
            })
            if (this.policy && sameValue(this.policy, value)) return this.policy
            return this.policy = value as unknown as MeasurePolicy
        }
        const schema = declaration.kind === 'Row' ? unitFieldContracts.row : declaration.kind === 'Column' ? unitFieldContracts.column : declaration.kind === 'FlowRow' || declaration.kind === 'FlowColumn' ? unitFieldContracts.flow : undefined
        if (!schema) return declaration
        const value = this.resolveArrangementPolicy(declaration)
        if (this.policy && sameValue(this.policy, value)) return this.policy
        return this.policy = value
    }

    private resolveModifierValue(type: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
        let value = input

        if (type === 'width' || type === 'height') value = replaceLength(value, 'value', this.resolveLength(value.valueDp, value.valuePx))
        else if (type === 'requiredWidth') value = replaceLength(value, 'width', this.resolveLength(value.widthDp, value.widthPx))
        else if (type === 'requiredHeight') value = replaceLength(value, 'height', this.resolveLength(value.heightDp, value.heightPx))
        else if (type === 'size' || type === 'requiredSize') value = replaceLengths(value, [
            ['width', 'widthDp', 'widthPx'],
            ['height', 'heightDp', 'heightPx'],
        ], this.density)
        else if (type === 'widthIn' || type === 'heightIn') value = replaceLengths(value, [
            ['min', 'minDp', 'minPx'],
            ['max', 'maxDp', 'maxPx'],
        ], this.density)
        else if (type === 'sizeIn') value = replaceLengths(value, [
            ['minWidth', 'minWidthDp', 'minWidthPx'],
            ['maxWidth', 'maxWidthDp', 'maxWidthPx'],
            ['minHeight', 'minHeightDp', 'minHeightPx'],
            ['maxHeight', 'maxHeightDp', 'maxHeightPx'],
        ], this.density)
        else if (type === 'defaultMinSize') value = replaceLengths(value, [
            ['minWidth', 'minWidthDp', 'minWidthPx'],
            ['minHeight', 'minHeightDp', 'minHeightPx'],
        ], this.density)
        else if (type === 'padding') value = replaceLengths(value, [
            ['start', 'startDp', 'startPx'],
            ['top', 'topDp', 'topPx'],
            ['end', 'endDp', 'endPx'],
            ['bottom', 'bottomDp', 'bottomPx'],
        ], this.density)
        else if (type === 'offset' || type === 'absoluteOffset') value = replaceLengths(value, [
            ['x', 'xDp', 'xPx'],
            ['y', 'yDp', 'yPx'],
        ], this.density)
        else if (type === 'border') value = replaceLength(value, 'width', this.resolveLength(value.widthDp, value.widthPx))

        if (value.shape && typeof value.shape === 'object') value = { ...value, shape: resolveShape(value.shape as Readonly<Record<string, unknown>>, this) }
        value = this.resolveFixedFields(type, value)
        return value
    }

    private resolveFixedFields(type: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
        const schema = fixedSchema(type)
        return schema ? this.fields(input, schema) : input
    }

    private fields<T extends Readonly<Record<string, unknown>>>(input: T, schema: UnitFields): T {
        let result: Record<string, unknown> | undefined
        for (const [name, unit] of Object.entries(schema)) {
            const value = input[name]
            if (value === undefined) continue
            const next = unit === 'sp' ? this.density.spToPx(value as number) : typeof unit === 'object' && value !== null && typeof value === 'object' ? this.fields(value as Record<string, unknown>, unit) : value
            if (next !== value) (result ??= { ...input })[name] = next
        }
        return result ? Object.freeze(result) as T : input
    }

    resolveLength(dp: unknown, px: unknown): number {
        if (dp === undefined && px === undefined) throw new TypeError('长度需要 DP 与 PX 双通道数值')
        const dpValue = dp === undefined ? 0 : finite(dp, 'DP')
        const pxValue = px === undefined ? 0 : finite(px, 'PX')
        return this.density.dpToPx(dpValue) + pxValue
    }

    private resolveArrangementPolicy<T extends MeasurePolicy>(declaration: T): T {
        if (declaration.kind === 'FlowRow' || declaration.kind === 'FlowColumn') {
            const resolve = (value: ArrangementProp | undefined) => {
                if (!value || typeof value !== 'object') return value
                const { spaceDp, spacePx, ...rest } = value
                return Object.freeze({ ...rest, space: this.resolveLength(spaceDp, spacePx) })
            }
            return Object.freeze({
                ...declaration,
                ...(declaration.horizontalArrangement !== undefined ? { horizontalArrangement: resolve(declaration.horizontalArrangement) } : {}),
                ...(declaration.verticalArrangement !== undefined ? { verticalArrangement: resolve(declaration.verticalArrangement) } : {}),
            }) as T
        }
        if (declaration.kind !== 'Row' && declaration.kind !== 'Column') return declaration
        const name = declaration.kind === 'Row' ? 'horizontalArrangement' : 'verticalArrangement'
        const arrangement = declaration.kind === 'Row' ? declaration.horizontalArrangement : declaration.verticalArrangement
        if (!arrangement || typeof arrangement !== 'object' || arrangement.kind !== 'spacedBy') return declaration
        const resolved = { ...arrangement, space: this.resolveLength(arrangement.spaceDp, arrangement.spacePx) }
        delete (resolved as { spaceDp?: number }).spaceDp
        delete (resolved as { spacePx?: number }).spacePx
        return Object.freeze({ ...declaration, [name]: Object.freeze(resolved) }) as T
    }
}

function resolveShape(shape: Readonly<Record<string, unknown>>, resolver: UnitResolver): Readonly<Record<string, unknown>> {
    if (shape.type !== 'rounded') return shape
    return replaceLength(shape, 'radius', resolver.resolveLength(shape.radiusDp, shape.radiusPx))
}

function fixedSchema(type: string): UnitFields | undefined {
    if (type === 'text') return { style: unitFieldContracts.style }
    if (type === 'textField') return { textStyle: unitFieldContracts.style }
    if (type === 'background' || type === 'border' || type === 'clip') return { shape: unitFieldContracts.shape }
    if (type === 'paint') return { colorFilter: { tint: 'color' } }
    return undefined
}

function replaceLength(input: Readonly<Record<string, unknown>>, name: string, value: number): Readonly<Record<string, unknown>> {
    const keys = Object.keys(input).filter(key => key !== `${name}Dp` && key !== `${name}Px`)
    const result: Record<string, unknown> = {}
    for (const key of keys) result[key] = input[key]
    result[name] = value
    return Object.freeze(result)
}

function replaceLengths(input: Readonly<Record<string, unknown>>, fields: readonly (readonly [string, string, string])[], density: Density): Readonly<Record<string, unknown>> {
    const removed = new Set(fields.flatMap(([, dp, px]) => [dp, px]))
    const result: Record<string, unknown> = {}
    for (const [name, dp, px] of fields) {
        if (input[dp] === undefined && input[px] === undefined) continue
        result[name] = density.dpToPx(input[dp] === undefined ? 0 : finite(input[dp], 'DP')) + (input[px] === undefined ? 0 : finite(input[px], 'PX'))
    }
    for (const key of Object.keys(input)) if (!removed.has(key)) result[key] = input[key]
    return Object.freeze(result)
}

function finite(value: unknown, unit: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${unit} 长度需要有限数值`)
    return value
}

function sameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
    }
    const a = left as Record<string, unknown>
    const b = right as Record<string, unknown>
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}
