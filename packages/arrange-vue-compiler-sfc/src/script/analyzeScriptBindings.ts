import { type BindingMetadata, BindingTypes, unwrapTSNode } from '@arrange/vue-compiler-arrange'
import { componentOptionNames, generateCodeFrame } from '@arrange/vue-shared'
import type { Node, ObjectExpression, Statement } from '@babel/types'
import type { ScriptCompileContext } from './context.ts'
import { resolveObjectKey } from './utils.ts'

// 普通 script 只分析正式 props 与 setup 返回的绑定
export function analyzeScriptBindings(ast: Statement[], ctx: ScriptCompileContext): BindingMetadata {
    for (const node of ast) {
        if (node.type !== 'ExportDefaultDeclaration') continue
        let declaration = unwrapTSNode(node.declaration)
        if (declaration.type === 'CallExpression' && declaration.callee.type === 'Identifier' && declaration.callee.name === 'defineComponent' && declaration.arguments[0]) declaration = unwrapTSNode(declaration.arguments[0])
        if (declaration.type !== 'ObjectExpression') continue

        const bindings: BindingMetadata = {}
        Object.defineProperty(bindings, '__isScriptSetup', { enumerable: false, value: false })

        for (const property of declaration.properties) {
            if (property.type === 'SpreadElement') continue
            const key = resolveObjectKey(property.key, property.computed)
            if (key !== undefined && !componentOptionNames.has(String(key))) {
                const offset = ctx.descriptor.script!.loc.start.offset
                throw new Error('Arrange 组件配置未定义：' + key + '\n' + ctx.filename + '\n' + generateCodeFrame(ctx.source, offset + property.start!, offset + property.end!))
            }

            if (key === 'props' && property.type === 'ObjectProperty') {
                for (const name of getObjectOrArrayExpressionKeys(property.value)) bindings[name] = BindingTypes.PROPS
            }

            const setup = property.type === 'ObjectMethod' ? property : property.value
            if (key !== 'setup' || (setup.type !== 'ObjectMethod' && setup.type !== 'FunctionExpression' && setup.type !== 'ArrowFunctionExpression')) continue
            if (setup.body.type === 'ObjectExpression') {
                for (const name of getObjectExpressionKeys(setup.body)) bindings[name] = BindingTypes.SETUP_MAYBE_REF
            } else if (setup.body.type === 'BlockStatement') {
                for (const statement of setup.body.body) {
                    if (statement.type !== 'ReturnStatement' || statement.argument?.type !== 'ObjectExpression') continue
                    for (const name of getObjectExpressionKeys(statement.argument)) bindings[name] = BindingTypes.SETUP_MAYBE_REF
                }
            }
        }

        return bindings
    }
    return {}
}

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
