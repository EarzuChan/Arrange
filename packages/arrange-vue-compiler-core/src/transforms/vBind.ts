import { camelize } from '@arrange/vue-shared'
import {
    type ExpressionNode,
    NodeTypes,
    createObjectProperty,
    createSimpleExpression,
} from '../ast.ts'
import { ErrorCodes, createCompilerError } from '../errors.ts'
import { CAMELIZE } from '../runtimeHelpers.ts'
import type { DirectiveTransform } from '../transform.ts'

// v-bind without arg is handled directly in ./transformElement.ts due to its affecting
// codegen for the entire props object. This transform here is only for v-bind
// *with* args.
export const transformBind: DirectiveTransform = (dir, _node, context) => {
    const { modifiers, loc } = dir
    const arg = dir.arg!

    let { exp } = dir

    // handle empty expression
    if (exp && exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim()) {
        {

            context.onError(
                createCompilerError(ErrorCodes.X_V_BIND_NO_EXPRESSION, loc),
            )
            return {
                props: [
                    createObjectProperty(arg, createSimpleExpression('', true, loc)),
                ],
            }
        }
    }

    if (arg.type !== NodeTypes.SIMPLE_EXPRESSION) {
        arg.children.unshift(`(`)
        arg.children.push(`) || ""`)
    } else if (!arg.isStatic) {
        arg.content = arg.content ? `${arg.content} || ""` : `""`
    }

    // .sync is replaced by v-model:arg
    if (modifiers.some(mod => mod.content === 'camel')) {
        if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
            if (arg.isStatic) {
                arg.content = camelize(arg.content)
            } else {
                arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`
            }
        } else {
            arg.children.unshift(`${context.helperString(CAMELIZE)}(`)
            arg.children.push(`)`)
        }
    }

    return {
        props: [createObjectProperty(arg, exp!)],
    }
}
