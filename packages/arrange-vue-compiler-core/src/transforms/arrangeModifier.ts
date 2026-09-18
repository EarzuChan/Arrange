import { parseExpression } from '@babel/parser'
import type { Node } from '@babel/types'
import { createArrayExpression, createCallExpression, createFunctionExpression, createSimpleExpression, type JSChildNode } from '../ast.ts'
import { BindingTypes } from '../options.ts'
import { ARRANGE_MODIFIER } from '../runtimeHelpers.ts'
import type { TransformContext } from '../transform.ts'
import { processExpression } from './transformExpression.ts'

const methods = new Set(['width', 'height', 'size', 'requiredWidth', 'requiredHeight', 'requiredSize', 'padding', 'offset', 'absoluteOffset', 'alpha', 'background', 'graphicsLayer', 'fillMaxWidth', 'fillMaxHeight', 'fillMaxSize', 'zIndex'])

// Only known factory chains with side-effect-free argument syntax are eligible.
// Calls, accessors, spreads, dynamic method names and conditional chain shapes
// retain the ordinary whole-expression effect and normal JS evaluation order.
export function splitArrangeModifier(value: JSChildNode, context: TransformContext): JSChildNode | undefined {
    const roots = context.bindingMetadata.__arrangeModifierRoots
    const source = value.loc.source
    if (!roots?.length || !source) return
    let parsed: Node
    try { parsed = parseExpression(source, { plugins: context.expressionPlugins }) } catch { return }
    const pure = (node: Node): boolean => {
        switch (node.type) {
            case 'NumericLiteral': case 'BooleanLiteral': case 'StringLiteral': case 'NullLiteral': return true
            case 'Identifier': return !context.identifiers[node.name] && [BindingTypes.SETUP_REF, BindingTypes.SETUP_CONST, BindingTypes.SETUP_MAYBE_REF, BindingTypes.PROPS].includes(context.bindingMetadata[node.name]!)
            case 'UnaryExpression': return ['+', '-', '!', '~'].includes(node.operator) && pure(node.argument)
            case 'BinaryExpression': case 'LogicalExpression': return pure(node.left) && pure(node.right)
            case 'ConditionalExpression': return pure(node.test) && pure(node.consequent) && pure(node.alternate)
            case 'ObjectExpression': return node.properties.every(property => property.type === 'ObjectProperty' && !property.computed && pure(property.value))
            default: return false
        }
    }
    const segments: { method: string; args: Node[] }[] = []
    let current: Node = parsed
    while (current.type === 'CallExpression' && current.callee.type === 'MemberExpression' && !current.callee.computed && current.callee.property.type === 'Identifier') {
        const method = current.callee.property.name
        if (!methods.has(method) || !current.arguments.every(pure)) return
        segments.unshift({ method, args: current.arguments })
        current = current.callee.object
    }
    if (current.type !== 'Identifier' || !roots.includes(current.name) || segments.length < 2 || context.identifiers[current.name]) return
    const expression = (text: string) => processExpression(createSimpleExpression(text, false, value.loc), context)
    return createCallExpression(context.helper(ARRANGE_MODIFIER), [
        expression(current.name),
        createArrayExpression(segments.map(segment => createArrayExpression([
            createSimpleExpression(segment.method, true),
            createFunctionExpression(undefined, createArrayExpression(segment.args.map(arg => expression(source.slice(arg.start!, arg.end!)))), true),
        ]))),
    ])
}
