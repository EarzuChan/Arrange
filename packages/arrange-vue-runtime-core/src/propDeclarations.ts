import { EMPTY_OBJ, arrangeParameterName, hasOwn, isArray, isFunction, isObject } from '@arrange/vue-shared'
import type { ArrangablePropsOptions, NormalizedProps, PropOptions } from './arrangableProps.ts'
import { arrangeExecutionStats } from './executionStats.ts'

type ParameterPlan = { definition: object; positions: Map<string, number>; entries: readonly { name: string; declaration: PropOptions; position: number }[] }
type ParameterValues = { plan: ParameterPlan; values: unknown[]; source?: string }
const parameterValues = new WeakMap<object, ParameterValues>()
const parameterPlans = new WeakMap<object, WeakMap<readonly string[], ParameterPlan>>()

// 编译器给出固定参数位置，模块定义只在调用点首次连接时参与名称匹配
export function arrangeParameters(definition: { props?: ArrangablePropsOptions }, names: readonly string[], values: unknown[], source?: string): Record<string, unknown> {
    arrangeExecutionStats.fixedParameterGroups++
    if (values.length !== names.length) throw new TypeError('编译参数的位置与值数量不一致')
    let plans = parameterPlans.get(definition)
    if (!plans) parameterPlans.set(definition, plans = new WeakMap())
    let plan = plans.get(names)
    if (!plan) {
        const declarations = normalizeDeclaredProps(definition.props)
        const positions = new Map<string, number>()
        for (let index = 0; index < names.length; index++) {
            const name = arrangeParameterName(names[index])
            if (positions.has(name)) throw new TypeError(`重复参数：${name}${source ? `\n来源：${source}` : ''}`)
            if (name !== 'key' && !hasOwn(declarations, name)) throw new TypeError(`Arrangable 未声明参数：${name}${source ? `\n来源：${source}` : ''}`)
            positions.set(name, index)
        }
        plan = { definition, positions, entries: Object.entries(declarations).map(([name, declaration]) => ({ name, declaration, position: positions.get(name) ?? -1 })) }
        plans.set(names, plan)
        arrangeExecutionStats.parameterPlans++
    }

    const provided: Record<string, unknown> = Object.create(null)
    for (const [name, position] of plan.positions) provided[name] = values[position]
    parameterValues.set(provided, { plan, values, source })
    return Object.freeze(provided)
}

export function copyParameters(raw: Record<string, unknown>): Record<string, unknown> {
    const next = { ...raw }
    const prepared = parameterValues.get(raw)
    if (prepared) parameterValues.set(next, { plan: prepared.plan, values: prepared.values.slice(), source: prepared.source })
    return next
}

export function assignParameter(raw: Record<string, unknown>, name: string, value: unknown): void {
    raw[name] = value
    const prepared = parameterValues.get(raw)
    const position = prepared?.plan.positions.get(name)
    if (position !== undefined) prepared!.values[position] = value
}

export function preparedParameters(raw: object | null, definition: object): ParameterValues | undefined {
    const prepared = raw && parameterValues.get(raw)
    return prepared && prepared.plan.definition === definition ? prepared : undefined
}

// 声明校验不依赖实例与渲染器，定义加载时即可完成
export function normalizeDeclaredProps(raw: ArrangablePropsOptions | undefined): NormalizedProps {
    const declarations: NormalizedProps = Object.create(null)
    if (raw != null && !isArray(raw) && !isObject(raw)) throw new TypeError('Arrangable 参数声明必须是对象或名称数组')

    const names = isArray(raw) ? raw : Object.keys(raw ?? EMPTY_OBJ)
    for (const original of names) {
        if (typeof original !== 'string' || !original) throw new TypeError('参数声明名称必须为非空字符串')
        const name = arrangeParameterName(original)
        if (name === 'key') throw new TypeError('key 是组合身份，不能声明为业务参数')
        if (hasOwn(declarations, name)) throw new TypeError(`重复参数声明：${name}`)

        const value = isArray(raw) ? null : raw![original]
        declarations[name] = isArray(value) || isFunction(value) ? { type: value } : { ...value }
    }
    return declarations
}
