import type {TransformContext} from '../transform.ts'
import {NodeTypes, type ExpressionNode} from '../ast.ts'

interface SlotAlias { expression: string; depth: number }
const scopes = new WeakMap<TransformContext, Map<string, SlotAlias>>()
const sequence = new WeakMap<TransformContext, number>()

export function slotParameterName(context: TransformContext): string {
    const index = sequence.get(context) ?? 0
    sequence.set(context, index + 1)
    return `_arrange_slot_${index}`
}

export function slotAlias(context: TransformContext, name: string, depth = context.identifiers[name]): string | undefined {
    const alias = scopes.get(context)?.get(name)
    return alias && alias.depth === depth && depth === context.identifiers[name] ? alias.expression : undefined
}

export function enterSlotAliases(context: TransformContext, aliases: Record<string, string>): () => void {
    let scope = scopes.get(context)
    if (!scope) scopes.set(context, scope = new Map())
    const previous = new Map<string, SlotAlias | undefined>()
    for (const [name, expression] of Object.entries(aliases)) {
        previous.set(name, scope.get(name))
        scope.set(name, {expression, depth: context.identifiers[name] ?? 0})
    }
    return () => {
        for (const [name, alias] of previous) {
            if (alias) scope.set(name, alias)
            else scope.delete(name)
        }
    }
}

// processExpression 的参数产物仅由前缀化标识符与原始标点组成。
export function parameterSource(expression: ExpressionNode): string {
    if (expression.type === NodeTypes.SIMPLE_EXPRESSION) return expression.content
    return expression.children.map(child => {
        if (typeof child === 'string') return child
        if (typeof child === 'symbol') throw new Error('Unexpected helper in slot parameter')
        if (child.type === NodeTypes.SIMPLE_EXPRESSION || child.type === NodeTypes.COMPOUND_EXPRESSION) return parameterSource(child)
        throw new Error('Unexpected node in slot parameter')
    }).join('')
}
