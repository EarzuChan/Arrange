import { isObject, isString } from '@arrange/shared'
import { parseExpression } from '@babel/parser'
import type { Expression, Node } from '@babel/types'
import { type DirectiveNode, type ElementNode, ElementTypes, type ExpressionNode, type InterpolationNode, NodeTypes, type Position, type RootNode, type SimpleExpressionNode, type TemplateChildNode, type TemplateNode, type TextNode } from './ast.ts'
import { unwrapTSNode } from './babelUtils.ts'
import { isWhitespace } from './tokenizer.ts'
import type { TransformContext } from './transform.ts'

export const isStaticExp = (p: ExpressionNode): p is SimpleExpressionNode => p.type === NodeTypes.SIMPLE_EXPRESSION && p.isStatic

const nonIdentifierRE = /^$|^\d|[^\$\w\xA0-\uFFFF]/
export const isSimpleIdentifier = (name: string): boolean => !nonIdentifierRE.test(name)

enum MemberExpLexState {
    inMemberExp,
    inBrackets,
    inParens,
    inString,
}

export const validFirstIdentCharRE: RegExp = /[A-Za-z_$\xA0-\uFFFF]/
const validIdentCharRE = /[\.\?\w$\xA0-\uFFFF]/
const whitespaceRE = /\s+[.[]\s*|\s*[.[]\s+/g

const getExpSource = (exp: ExpressionNode): string => exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : exp.loc.source

/**
 * Simple lexer to check if an expression is a member expression. This is
 * lax and only checks validity at the root level (i.e. does not validate exps
 * inside square brackets), but it's ok since these are only used on template
 * expressions and false positives are invalid expressions in the first place.
 */
export const isMemberExpressionBrowser = (exp: ExpressionNode): boolean => {
    // remove whitespaces around . or [ first
    const path = getExpSource(exp).trim().replace(whitespaceRE, s => s.trim())

    let state = MemberExpLexState.inMemberExp
    let stateStack: MemberExpLexState[] = []
    let currentOpenBracketCount = 0
    let currentOpenParensCount = 0
    let currentStringType: "'" | '"' | '`' | null = null

    for (let i = 0; i < path.length; i++) {
        const char = path.charAt(i)

        switch (state) {
            case MemberExpLexState.inMemberExp:
                if (char === '[') {
                    stateStack.push(state)
                    state = MemberExpLexState.inBrackets
                    currentOpenBracketCount++
                } else if (char === '(') {
                    stateStack.push(state)
                    state = MemberExpLexState.inParens
                    currentOpenParensCount++
                } else if (!(i === 0 ? validFirstIdentCharRE : validIdentCharRE).test(char)) return false

                break

            case MemberExpLexState.inBrackets:
                if (char === `'` || char === `"` || char === '`') {
                    stateStack.push(state)
                    state = MemberExpLexState.inString
                    currentStringType = char
                } else if (char === `[`) currentOpenBracketCount++
                else if (char === `]`) {
                    if (!--currentOpenBracketCount) state = stateStack.pop()!
                }

                break

            case MemberExpLexState.inParens:
                if (char === `'` || char === `"` || char === '`') {
                    stateStack.push(state)
                    state = MemberExpLexState.inString
                    currentStringType = char
                } else if (char === `(`) currentOpenParensCount++
                else if (char === `)`) {
                    // if the exp ends as a call then it should not be considered valid
                    if (i === path.length - 1) return false
                    if (!--currentOpenParensCount) state = stateStack.pop()!
                }

                break

            case MemberExpLexState.inString:
                if (char === currentStringType) {
                    state = stateStack.pop()!
                    currentStringType = null
                }

                break
        }
    }

    return !currentOpenBracketCount && !currentOpenParensCount
}

export const isMemberExpressionNode: (exp: ExpressionNode, context: TransformContext) => boolean = ((exp, context) => {
    try {
        let ret: Node = exp.ast || parseExpression(getExpSource(exp), {
            plugins: context.expressionPlugins
                ? [...context.expressionPlugins, 'typescript']
                : ['typescript'],
        })

        ret = unwrapTSNode(ret) as Expression

        return (ret.type === 'MemberExpression' || ret.type === 'OptionalMemberExpression' || (ret.type === 'Identifier' && ret.name !== 'undefined'))
    } catch (e) {
        return false
    }
})

export const isMemberExpression: (exp: ExpressionNode, context: TransformContext) => boolean = (isMemberExpressionNode)

const fnExpRE = /^\s*(?:async\s*)?(?:\([^)]*?\)|[\w$_]+)\s*(?::[^=]+)?=>|^\s*(?:async\s+)?function(?:\s+[\w$]+)?\s*\(/

export const isFnExpressionBrowser: (exp: ExpressionNode) => boolean = exp => fnExpRE.test(getExpSource(exp))

export const isFnExpressionNode: (exp: ExpressionNode, context: TransformContext) => boolean = ((exp, context) => {
    try {
        let ret: Node = exp.ast || parseExpression(getExpSource(exp), {
            plugins: context.expressionPlugins
                ? [...context.expressionPlugins, 'typescript']
                : ['typescript'],
        })

        // parser may parse the exp as statements when it contains semicolons
        if (ret.type === 'Program') {
            ret = ret.body[0]
            if (ret.type === 'ExpressionStatement') ret = ret.expression
        }

        ret = unwrapTSNode(ret) as Expression

        return (ret.type === 'FunctionExpression' || ret.type === 'ArrowFunctionExpression')
    } catch (e) {
        return false
    }
})

export const isFnExpression: (exp: ExpressionNode, context: TransformContext) => boolean = (isFnExpressionNode)

export function advancePositionWithClone(pos: Position, source: string, numberOfCharacters: number = source.length): Position {
    return advancePositionWithMutation({ offset: pos.offset, line: pos.line, column: pos.column, }, source, numberOfCharacters,)
}

// advance by mutation without cloning (for performance reasons), since this
// gets called a lot in the parser
export function advancePositionWithMutation(pos: Position, source: string, numberOfCharacters: number = source.length): Position {
    let linesCount = 0
    let lastNewLinePos = -1

    for (let i = 0; i < numberOfCharacters; i++) {
        if (source.charCodeAt(i) === 10 /* newline char code */) {
            linesCount++
            lastNewLinePos = i
        }
    }

    pos.offset += numberOfCharacters
    pos.line += linesCount
    pos.column = lastNewLinePos === -1 ? pos.column + numberOfCharacters : numberOfCharacters - lastNewLinePos

    return pos
}

export function assert(condition: boolean, msg?: string): void {
    /* v8 ignore next 3 */
    if (!condition) throw new Error(msg || `unexpected compiler condition`)
}

export function findDir(node: ElementNode, name: string | RegExp, allowEmpty: boolean = false): DirectiveNode | undefined {
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i]

        if (p.type === NodeTypes.DIRECTIVE && (allowEmpty || p.exp) && (isString(name) ? p.name === name : name.test(p.name))) return p
    }
}

export function findProp(node: ElementNode, name: string, dynamicOnly: boolean = false, allowEmpty: boolean = false): ElementNode['props'][0] | undefined {
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i]

        if (p.type === NodeTypes.ATTRIBUTE) {
            if (dynamicOnly) continue

            if (p.name === name && (p.value || allowEmpty)) return p
        } else if (p.name === 'bind' && (p.exp || allowEmpty) && isStaticArgOf(p.arg, name)) return p
    }
}

export function isStaticArgOf(arg: DirectiveNode['arg'], name: string): boolean {
    return !!(arg && isStaticExp(arg) && arg.content === name)
}

export function hasDynamicKeyVBind(node: ElementNode): boolean {
    return node.props.some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && (!p.arg || p.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !p.arg.isStatic))
}

// 这几个真该肃清了：开始

export function isText(node: TemplateChildNode): node is TextNode | InterpolationNode {
    return node.type === NodeTypes.INTERPOLATION || node.type === NodeTypes.TEXT
}

export function isVPre(p: ElementNode['props'][0]): p is DirectiveNode {
    return p.type === NodeTypes.DIRECTIVE && p.name === 'pre'
}

export function isVSlot(p: ElementNode['props'][0]): p is DirectiveNode {
    return p.type === NodeTypes.DIRECTIVE && p.name === 'slot'
}

// 结束

export function isTemplateNode(node: RootNode | TemplateChildNode): node is TemplateNode {
    return (node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.TEMPLATE)
}

export const forAliasRE: RegExp = /([\s\S]*?)\s+(?:in|of)\s+(\S[\s\S]*)/

export function isAllWhitespace(str: string): boolean {
    for (let i = 0; i < str.length; i++) if (!isWhitespace(str.charCodeAt(i))) return false

    return true
}

export function isWhitespaceText(node: TemplateChildNode): boolean {
    return node.type === NodeTypes.TEXT && isAllWhitespace(node.content)
}

export function isCommentOrWhitespace(node: TemplateChildNode): boolean {
    return node.type === NodeTypes.COMMENT || isWhitespaceText(node)
}