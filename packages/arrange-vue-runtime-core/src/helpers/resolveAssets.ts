import { isString } from '@arrange/vue-shared'
import { currentInstance, getArrangableName, type ConcreteArrangable } from '../arrangable.ts'
import type { ArrangableOptions } from '../arrangableOptions.ts'
import { currentRenderingInstance } from '../arrangableRenderContext.ts'
import type { VNodeTypes } from '../vnode.ts'

export function resolveArrangable(name: string, maybeSelfReference = false): ConcreteArrangable {
    const instance = currentRenderingInstance || currentInstance
    if (!instance) throw new Error('Arrangable 名称只能在 setup 或结构执行中解析')

    const own = instance.type
    if (getArrangableName(own, false) === name) return own
    const definition = (own as ArrangableOptions).arrangables?.[name] ?? instance.appContext.arrangables[name]
    if (definition) return definition as ConcreteArrangable
    if (maybeSelfReference) return own
    throw new TypeError(`无法解析 Arrangable 定义：${name}`)
}

export const NULL_DYNAMIC_ARRANGABLE: unique symbol = Symbol('空动态调用')

export function resolveDynamicArrangable(definition: unknown): VNodeTypes {
    if (isString(definition)) return resolveArrangable(definition)
    return (definition || NULL_DYNAMIC_ARRANGABLE) as VNodeTypes
}
