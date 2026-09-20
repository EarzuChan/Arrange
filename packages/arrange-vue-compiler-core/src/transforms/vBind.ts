import { camelize } from '@arrange/vue-shared'
import { NodeTypes, createCompoundExpression, createObjectProperty, createSimpleExpression } from '../ast.ts'
import { ARRANGE_PARAMETER_NAME } from '../runtimeHelpers.ts'
import type { DirectiveTransform } from '../transform.ts'

export const transformBind: DirectiveTransform = (directive, _node, context) => {
    const { exp, arg, loc } = directive
    if (!exp || exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim()) throw Object.assign(new SyntaxError('参数绑定必须显式提供表达式'), { loc })
    if (!arg) throw Object.assign(new SyntaxError('此参数绑定缺少名称'), { loc })

    const name = arg.type === NodeTypes.SIMPLE_EXPRESSION && arg.isStatic ? createSimpleExpression(camelize(arg.content), true, arg.loc) : createCompoundExpression([`${context.helperString(ARRANGE_PARAMETER_NAME)}(`, arg, ')'], arg.loc)
    return { props: [createObjectProperty(name, exp)] }
}
