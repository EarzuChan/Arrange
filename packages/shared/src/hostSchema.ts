import { camelize } from './general.ts'

export function arrangeParameterName(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new TypeError('参数名称必须是非空字符串')

    return camelize(value)
}

// 对象绑定在字段组装前统一校验名称，不能经由 spread 静默丢失非法输入
export function normalizeParameterObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('参数对象必须是非空对象')

    const result: Record<string, unknown> = Object.create(null)
    for (const original of Reflect.ownKeys(value)) {
        if (!Object.prototype.propertyIsEnumerable.call(value, original)) continue
        const name = arrangeParameterName(original)
        if (Object.prototype.hasOwnProperty.call(result, name)) throw new TypeError(`重复参数：${name}`)
        result[name] = (value as Record<string, unknown>)[name === original ? name : original as string]
    }

    return result
}

// 原生节点输入与 Arrangable 参数分别由自身边界解释
export const layoutNodeInputs = new Set(['modifier', 'measurePolicy', 'enabled', 'contentDescription', 'label', 'description', 'role'])

export const canonicalHostInput = arrangeParameterName
