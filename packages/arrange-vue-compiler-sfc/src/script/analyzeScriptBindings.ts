import type { Node, ObjectExpression } from '@babel/types'
import { resolveObjectKey } from './utils.ts'

function getObjectExpressionKeys(node: ObjectExpression): string[] {
    const keys: string[] = []
    for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') continue
        const key = resolveObjectKey(prop.key, prop.computed)
        if (key !== undefined) keys.push(String(key))
    }
    return keys
}

export function getObjectOrArrayExpressionKeys(value: Node): string[] {
    if (value.type === 'ObjectExpression') return getObjectExpressionKeys(value)
    if (value.type === 'ArrayExpression') return value.elements.flatMap(element => element?.type === 'StringLiteral' ? [element.value] : [])
    return []
}
