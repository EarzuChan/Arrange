import { currentInstance, type ArrangableDefinition } from '../arrangable.ts'
import { isArrangableDefinition } from '../apiDefineArrangable.ts'

export function resolveArrangable(name: string): ArrangableDefinition {
    const definition = currentInstance?.appContext.definitions[name]
    if (!definition) throw new TypeError(`未找到 Arrangable 定义：${name}`)
    return definition
}

export function resolveDynamicArrangable(value: unknown): ArrangableDefinition {
    if (!isArrangableDefinition(value)) throw new TypeError('动态目标必须是 Arrangable 定义')
    return value
}
