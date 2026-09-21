import { EMPTY_OBJ, arrangeParameterName, hasOwn, isArray, isFunction, isObject } from '@arrange/shared'
import type { ArrangablePropsOptions, NormalizedProps } from './arrangableProps.ts'
import type { ArrangableDefinition } from './arrangable.ts'
import { arrangeExecutionStats } from './executionStats.ts'

const declarationsCache = new WeakMap<object, NormalizedProps>()

export function normalizeDeclaredProps(raw: ArrangablePropsOptions | undefined): NormalizedProps {
    if (raw && declarationsCache.has(raw)) return declarationsCache.get(raw)!
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
    if (raw && Object.isFrozen(raw)) declarationsCache.set(raw, declarations)
    return declarations
}

export interface ParameterPlan {
    readonly definition: ArrangableDefinition
    readonly names: readonly string[]
    readonly fields: readonly { readonly name: string; readonly position: number }[]
}

const parameterPlans = new WeakSet<object>()

// 只预连接声明和位置，getter 与默认值工厂仍在实际调用的实例内求值
export function prepareParameters(definition: ArrangableDefinition, names: readonly string[], slots: readonly string[] = [], source?: string): ParameterPlan {
    const declarations = normalizeDeclaredProps(definition.props)
    const positions = new Map<string, number>()
    const fail = (message: string): never => { throw new TypeError(message + (source ? `\n来源：${source}` : '')) }
    for (const [position, original] of names.entries()) {
        arrangeExecutionStats.parameterNameChecks++
        const name = arrangeParameterName(original)
        if (!hasOwn(declarations, name)) fail(`Arrangable 未声明参数：${name}`)
        if (positions.has(name)) fail(`重复参数：${name}`)
        positions.set(name, position)
    }
    for (const slot of slots) if (!definition.contentTarget && !definition.slotNames.includes(slot)) fail(`Arrangable 未声明内容：${slot}`)
    const fields = Object.entries(declarations).map(([name, declaration]) => {
        const position = positions.get(name) ?? -1
        if (position < 0 && declaration.required && !hasOwn(declaration, 'default')) fail(`缺少必需参数：${name}`)
        return Object.freeze({ name, position })
    })
    const plan = Object.freeze({ definition, names: Object.freeze([...names]), fields: Object.freeze(fields) })
    parameterPlans.add(plan)
    return plan
}

export function checkParameterPlan(plan: ParameterPlan, definition: ArrangableDefinition): void {
    if (!parameterPlans.has(plan) || plan.definition !== definition) throw new TypeError('参数位置计划不属于当前 Arrangable 定义')
}