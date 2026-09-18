import { unwrapTSNode } from '@arrange/vue-compiler-arrange'
import { defineOptionsNames } from '@arrange/vue-shared'
import type { Node } from '@babel/types'
import type { ScriptCompileContext } from './context.ts'
import { isCallOf, resolveObjectKey } from './utils.ts'

export const DEFINE_OPTIONS = 'defineOptions'

export function processDefineOptions(ctx: ScriptCompileContext, node: Node): boolean {
    if (!isCallOf(node, DEFINE_OPTIONS)) return false
    if (ctx.hasDefineOptionsCall) ctx.error('defineOptions() 不可重复调用', node)
    if (node.typeParameters) ctx.error('defineOptions() 不接受类型参数', node)
    ctx.hasDefineOptionsCall = true
    if (!node.arguments[0]) return true

    ctx.optionsRuntimeDecl = unwrapTSNode(node.arguments[0])
    if (ctx.optionsRuntimeDecl.type !== 'ObjectExpression') ctx.error('defineOptions() 需要可静态检查的配置对象', ctx.optionsRuntimeDecl)
    for (const prop of ctx.optionsRuntimeDecl.properties) {
        if (prop.type === 'SpreadElement') ctx.error('defineOptions() 不接受动态展开，请显式声明配置字段', prop)
        const key = resolveObjectKey(prop.key, prop.computed)
        if (key === undefined || !defineOptionsNames.has(String(key))) ctx.error('defineOptions() 仅支持 name、inheritAttrs、components、directives，收到：' + (key ?? '动态键'), prop)
    }

    return true
}
