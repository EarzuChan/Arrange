import { modifierUnitFields, unitFieldContracts, type UnitFields } from '@arrange/shared'
import type { Density } from './density.ts'
import type { Modifier, ModifierElement } from './modifier.ts'
import type { MeasurePolicy } from './measurePolicy.ts'

export interface PxModifier {
    readonly elements: readonly ModifierElement[]
}

// 每个 Layout 独立拥有解析缓存，同一声明可在不同 Density 下使用
export class UnitResolver {
    private readonly elements = new WeakMap<ModifierElement, ModifierElement>()
    private previous: PxModifier | undefined
    private policy: MeasurePolicy | undefined

    constructor(private readonly density: Density) { }

    modifier(declaration: Modifier): PxModifier {
        const elements = declaration.elements.map(element => {
            let input = element.value
            const styleField = element.type === 'text' ? 'style' : element.type === 'textField' ? 'textStyle' : undefined
            if (styleField) input = { ...input, [styleField]: { fontSize: 14, lineHeight: 0, ...input[styleField] as object } }

            const value = this.fields(input, modifierUnitFields[element.type] ?? {})
            const previous = this.elements.get(element)
            if (previous && sameFields(previous.value, value, modifierUnitFields[element.type] ?? {})) return previous
            const resolved = value === element.value ? element : Object.freeze({ ...element, value })
            this.elements.set(element, resolved)
            return resolved
        })

        if (this.previous && elements.length === this.previous.elements.length && elements.every((element, index) => element === this.previous!.elements[index])) return this.previous
        return this.previous = Object.freeze({ elements: Object.freeze(elements) })
    }

    measurePolicy(declaration: MeasurePolicy): MeasurePolicy {
        const schema = declaration.kind === 'Row' ? unitFieldContracts.row : declaration.kind === 'Column' ? unitFieldContracts.column : undefined
        const value = schema ? this.fields(declaration, schema) as MeasurePolicy : declaration
        if (this.policy && sameFields(this.policy, value, schema ?? {})) return this.policy
        return this.policy = value
    }

    private fields<T extends Readonly<Record<string, unknown>>>(input: T, schema: UnitFields): T {
        let result: Record<string, unknown> | undefined
        for (const [name, unit] of Object.entries(schema)) {
            const value = input[name]
            if (value === undefined) continue
            const next = unit === 'dp' ? this.density.dpToPx(value as number) : unit === 'sp' ? this.density.spToPx(value as number) : typeof unit === 'object' && value !== null && typeof value === 'object' ? this.fields(value as Record<string, unknown>, unit) : value
            if (next !== value) (result ??= { ...input })[name] = next
        }
        return result ? Object.freeze(result) as T : input
    }
}

function sameFields(left: unknown, right: unknown, schema: UnitFields): boolean {
    if (Object.is(left, right)) return true
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
    const a = left as Record<string, unknown>
    const b = right as Record<string, unknown>
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && (typeof schema[key] === 'object' ? sameFields(a[key], b[key], schema[key]) : Object.is(a[key], b[key])))
}
