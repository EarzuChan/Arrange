// 按真实绑定来源改写表达式，并保留每个标识符的源码位置
import { genPropsAccessExp, hasOwn, isGloballyAllowed, isString, makeMap } from '@arrange/shared'
import { parseExpression } from '@babel/parser'
import type { AssignmentExpression, Identifier, Node, UpdateExpression } from '@babel/types'
import { type CompoundExpressionNode, ConstantTypes, type ExpressionNode, NodeTypes, type SimpleExpressionNode, createCompoundExpression, createSimpleExpression } from '../ast.ts'
import { isInDestructureAssignment, isInNewExpression, isStaticProperty, isStaticPropertyKey, walkIdentifiers } from '../babelUtils.ts'
import { ErrorCodes, createCompilerError } from '../errors.ts'
import { BindingTypes } from '../options.ts'
import { IS_REF, UNREF } from '../runtimeHelpers.ts'
import type { TransformContext } from '../transform.ts'
import { advancePositionWithClone, isSimpleIdentifier } from '../utils.ts'
import { normalizeSfaUnitSyntax, restoreBabelNodePositions } from '../unitSyntax.ts'

const isLiteralWhitelisted = makeMap('true,false,null,this')

interface PrefixMeta {
    prefix?: string
    isConstant: boolean
    start: number
    end: number
    scopeIds?: Set<string>
}

export function processExpression(node: SimpleExpressionNode, context: TransformContext, asParams = false, asRawStatements = false, localVars: Record<string, number> = Object.create(context.identifiers)): ExpressionNode {

    if (!context.prefixIdentifiers || !node.content.trim()) {
        return node
    }

    const { inline, bindingMetadata } = context
    const rewriteIdentifier = (raw: string, parent?: Node | null, id?: Identifier) => {
        const type = hasOwn(bindingMetadata, raw) && bindingMetadata[raw]
        if (node.preserveRef && inline && type && type.startsWith('setup') || inRawRefScope(id?.start == null ? -1 : id.start - 1)) return raw
        if (inline) {
            const isAssignmentLVal = parent && parent.type === 'AssignmentExpression' && parent.left === id
            const isUpdateArg = parent && parent.type === 'UpdateExpression' && parent.argument === id
            const isDestructureAssignment = parent && isInDestructureAssignment(parent, parentStack)
            const isNewExpression = parent && isInNewExpression(parentStack)
            const wrapWithUnref = (raw: string) => {
                const wrapped = `${context.helperString(UNREF)}(${raw})`
                return isNewExpression ? `(${wrapped})` : wrapped
            }

            if (
                isConst(type) || type === BindingTypes.SETUP_REACTIVE_CONST || localVars[raw]
            ) {
                return raw
            } else if (type === BindingTypes.SETUP_REF) {
                if (parent?.type === 'MemberExpression' && parent.object === id && !parent.computed && parent.property.type === 'Identifier' && parent.property.name === 'value') return raw
                return `${raw}.value`
            } else if (type === BindingTypes.SETUP_MAYBE_REF) {
                return isAssignmentLVal || isUpdateArg || isDestructureAssignment ? `${raw}.value` : wrapWithUnref(raw)
            } else if (type === BindingTypes.SETUP_LET) {
                if (isAssignmentLVal) {
                    const { right: rVal, operator } = parent as AssignmentExpression
                    const rExp = rawExp.slice(rVal.start! - 1, rVal.end! - 1)
                    const rExpString = stringifyExpression(processExpression(createSimpleExpression(rExp, false), context, false, false, knownIds))
                    return `${context.helperString(IS_REF)}(${raw})${context.isTS ? ` //@ts-ignore\n` : ``} ? ${raw}.value ${operator} ${rExpString} : ${raw}`
                } else if (isUpdateArg) {
                    id!.start = parent!.start
                    id!.end = parent!.end
                    const { prefix: isPrefix, operator } = parent as UpdateExpression
                    const prefix = isPrefix ? operator : ``
                    const postfix = isPrefix ? `` : operator
                    return `${context.helperString(IS_REF)}(${raw})${context.isTS ? ` //@ts-ignore\n` : ``} ? ${prefix}${raw}.value${postfix} : ${prefix}${raw}${postfix}`
                } else if (isDestructureAssignment) {
                    return raw
                } else {
                    return wrapWithUnref(raw)
                }
            } else if (type === BindingTypes.PROPS) {
                return genPropsAccessExp(raw)
            } else if (type === BindingTypes.PROPS_ALIASED) {
                return genPropsAccessExp(bindingMetadata.__propsAliases![raw])
            }
        } else {
            if (
                (type && type.startsWith('setup')) || type === BindingTypes.LITERAL_CONST
            ) {
                return `$setup.${raw}`
            } else if (type === BindingTypes.PROPS_ALIASED) {
                return `$props['${bindingMetadata.__propsAliases![raw]}']`
            } else if (type) {
                return `$${type}.${raw}`
            }
        }

        return `_ctx.${raw}`
    }

    const rawExp = markRawRefScopes(node)
    const rawRefRanges = node.rawRefRanges ?? []
    const inRawRefScope = (offset: number) => rawRefRanges.some(([start, end]) => offset >= start && offset < end)

    let ast = node.ast

    if (ast === false) {
        return node
    }

    if (ast === null || (!ast && isSimpleIdentifier(rawExp))) {
        const isScopeVarReference = context.identifiers[rawExp]
        const isAllowedGlobal = isGloballyAllowed(rawExp)
        const isLiteral = isLiteralWhitelisted(rawExp)
        if (
            !asParams && !isScopeVarReference && !isLiteral && (!isAllowedGlobal || bindingMetadata[rawExp])
        ) {
            if (isConst(bindingMetadata[rawExp])) {
                node.constType = ConstantTypes.CAN_REUSE_VALUE
            }
            node.content = rewriteIdentifier(rawExp)
        } else if (!isScopeVarReference) {
            if (isLiteral) {
                node.constType = ConstantTypes.CAN_STRINGIFY
            } else {
                node.constType = ConstantTypes.CAN_CACHE
            }
        }
        return node
    }

    if (!ast) {
        const source = asRawStatements ? ` ${rawExp} ` : `(${rawExp})${asParams ? `=>{}` : ``}`
        try {
            const normalized = normalizeSfaUnitSyntax(source)
            ast = parseExpression(normalized.content, {
                sourceType: 'module',
                plugins: context.expressionPlugins,
            })
            restoreBabelNodePositions(ast, normalized.restore)
        } catch (e: any) {
            context.onError(createCompilerError(ErrorCodes.X_INVALID_EXPRESSION, node.loc, undefined, e.message))
            return node
        }
    }

    type QualifiedId = Identifier & PrefixMeta
    const ids: QualifiedId[] = []
    const parentStack: Node[] = []
    const knownIds: Record<string, number> = Object.create(context.identifiers)

    walkIdentifiers(
        ast,
        (node, parent, _, isReferenced, isLocal) => {
            if (isStaticPropertyKey(node, parent!)) {
                return
            }
            const needPrefix = isReferenced && canPrefix(node)
            if (needPrefix && !isLocal) {
                if (isStaticProperty(parent!) && parent.shorthand) {

                    (node as QualifiedId).prefix = `${node.name}: `
                }
                node.name = rewriteIdentifier(node.name, parent, node)
                ids.push(node as QualifiedId)
            } else {
                if (
                    !(needPrefix && isLocal) && (!parent || (parent.type !== 'CallExpression' && parent.type !== 'NewExpression' && parent.type !== 'MemberExpression'))
                ) {

                    (node as QualifiedId).isConstant = true
                }
                ids.push(node as QualifiedId)
            }
        },
        true,
        parentStack,
        knownIds,
    )

    const children: CompoundExpressionNode['children'] = []
    ids.sort((a, b) => a.start - b.start)
    ids.forEach((id, i) => {
        const start = id.start - 1
        const end = id.end - 1
        const last = ids[i - 1]
        const leadingText = rawExp.slice(last ? last.end - 1 : 0, start)
        if (leadingText.length || id.prefix) {
            children.push(leadingText + (id.prefix || ``))
        }
        const source = rawExp.slice(start, end)
        children.push(
            createSimpleExpression(
                id.name,
                false,
                {
                    start: advancePositionWithClone(node.loc.start, rawExp, start),
                    end: advancePositionWithClone(node.loc.start, rawExp, end),
                    source,
                },
                id.isConstant ? ConstantTypes.CAN_STRINGIFY : ConstantTypes.NOT_CONSTANT,
            ),
        )
        if (i === ids.length - 1 && end < rawExp.length) {
            children.push(rawExp.slice(end))
        }
    })

    let ret
    if (children.length) {
        ret = createCompoundExpression(children, node.loc)
        ret.ast = ast
    } else {
        ret = node
        ret.constType = ConstantTypes.CAN_STRINGIFY
    }
    ret.identifiers = Object.keys(knownIds)
    return ret
}

function canPrefix(id: Identifier) {
    if (isGloballyAllowed(id.name)) {
        return false
    }
    if (id.name === 'require') {
        return false
    }
    return true
}

// 把尖括号标记剥掉，保留其内部源码范围；真正跳过 Ref 解包由作用域判断完成
function markRawRefScopes(node: SimpleExpressionNode): string {
    const source = node.content
    const output = source.split('')
    const ranges: [number, number][] = [...(node.rawRefRanges ?? [])]
    const previousSignificant = (index: number) => {
        for (let cursor = index - 1; cursor >= 0; cursor--) if (!/\s/.test(source[cursor])) return source[cursor]
        return ''
    }
    for (let index = 0; index < source.length; index++) {
        if (source[index] !== '<') continue
        const previous = previousSignificant(index)
        if (previous && /[\w$).\]]/.test(previous)) continue
        let depth = 0
        let quote = ''
        let close = -1
        for (let cursor = index + 1; cursor < source.length; cursor++) {
            const character = source[cursor]
            if (quote) {
                if (character === quote && source[cursor - 1] !== '\\') quote = ''
                continue
            }
            if (character === '"' || character === "'" || character === '`') {
                quote = character
                continue
            }
            if (character === '(' || character === '[' || character === '{') depth++
            else if (character === ')' || character === ']' || character === '}') depth--
            else if (character === '>' && depth === 0) {
                close = cursor
                break
            }
        }
        if (close < 0) continue
        const inner = source.slice(index + 1, close).trim()
        if (!inner || /[<>]/.test(inner)) continue
        ranges.push([index + 1, close])
        output[index] = ' '
        output[close] = ' '
        index = close
    }
    node.rawRefRanges = ranges
    return output.join('')
}

export function stringifyExpression(exp: ExpressionNode | string): string {
    if (isString(exp)) {
        return exp
    } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
        return exp.content
    } else {
        return (exp.children as (ExpressionNode | string)[]).map(stringifyExpression).join('')
    }
}

function isConst(type: unknown) {
    return (type === BindingTypes.SETUP_CONST || type === BindingTypes.LITERAL_CONST)
}
