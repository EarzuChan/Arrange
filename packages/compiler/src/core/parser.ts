import { NO, extend } from '@arrange/shared'
import { type ParserOptions as BabelOptions, parse, parseExpression } from '@babel/parser'
import { decodeHTML } from 'entities/decode'
import { type AttributeNode, ConstantTypes, type DirectiveNode, type ElementNode, ElementTypes, type ForParseResult, Namespaces, NodeTypes, type RootNode, type SimpleExpressionNode, type SourceLocation, type TemplateChildNode, createRoot, createSimpleExpression } from './ast.ts'
import { ErrorCodes, createCompilerError, defaultOnError, defaultOnWarn } from './errors.ts'
import type { ParserOptions } from './options.ts'
import Tokenizer, { CharCodes, ParseMode, QuoteType, Sequences, State, isWhitespace, toCharCodes } from './tokenizer.ts'
import { forAliasRE, isAllWhitespace, isSimpleIdentifier } from './utils.ts'

type OptionalOptions = 'decodeEntities' | 'whitespace' | 'isNativeTag' | 'isBuiltInArrangable' | 'expressionPlugins'

export type MergedParserOptions = Omit<Required<ParserOptions>, OptionalOptions> & Pick<ParserOptions, OptionalOptions>

export const defaultParserOptions: MergedParserOptions = {
    parseMode: 'base',
    ns: Namespaces.HTML,
    delimiters: [`{{`, `}}`],
    getNamespace: () => Namespaces.HTML,
    isVoidTag: NO,
    isPreTag: NO,
    isIgnoreNewlineTag: NO,
    onError: defaultOnError,
    onWarn: defaultOnWarn,
    comments: __DEV__,
    prefixIdentifiers: false,
}

let currentOptions: MergedParserOptions = defaultParserOptions
let currentRoot: RootNode | null = null

// parser state
let currentInput = ''
let currentOpenTag: ElementNode | null = null
let currentProp: AttributeNode | DirectiveNode | null = null
let currentAttrValue = ''
let currentAttrStartIndex = -1
let currentAttrEndIndex = -1
let inPre = 0
const stack: ElementNode[] = []

const tokenizer = new Tokenizer(stack, {
    onerr: emitError,
    ontext(start, end) {
        onText(getSlice(start, end), start, end)
    },
    ontextentity(char, start, end) {
        onText(char, start, end)
    },
    oninterpolation(start, end) {
        let innerStart = start + tokenizer.delimiterOpen.length
        let innerEnd = end - tokenizer.delimiterClose.length
        while (isWhitespace(currentInput.charCodeAt(innerStart))) {
            innerStart++
        }
        while (isWhitespace(currentInput.charCodeAt(innerEnd - 1))) {
            innerEnd--
        }
        let exp = getSlice(innerStart, innerEnd)
        // decode entities for backwards compat
        if (exp.includes('&')) {
            {
                exp = decodeHTML(exp)
            }
        }
        addNode({
            type: NodeTypes.INTERPOLATION,
            content: createExp(exp, false, getLoc(innerStart, innerEnd)),
            loc: getLoc(start, end),
        })
    },
    onopentagname(start, end) {
        const name = getSlice(start, end)
        currentOpenTag = {
            type: NodeTypes.ELEMENT,
            tag: name,
            ns: currentOptions.getNamespace(name, stack[0], currentOptions.ns),
            tagType: ElementTypes.ELEMENT, // will be refined on tag close
            props: [],
            children: [],
            loc: getLoc(start - 1, end),
        }
    },
    onopentagend(end) {
        endOpenTag(end)
    },
    onclosetag(start, end) {
        const name = getSlice(start, end)
        if (!currentOptions.isVoidTag(name)) {
            let found = false
            for (let i = 0; i < stack.length; i++) {
                const e = stack[i]
                if (e.tag.toLowerCase() === name.toLowerCase()) {
                    found = true
                    if (i > 0) {
                        emitError(ErrorCodes.X_MISSING_END_TAG, stack[0].loc.start.offset)
                    }
                    for (let j = 0; j <= i; j++) {
                        const el = stack.shift()!
                        onCloseTag(el, end, j < i)
                    }
                    break
                }
            }
            if (!found) {
                emitError(ErrorCodes.X_INVALID_END_TAG, backTrack(start, CharCodes.Lt))
            }
        }
    },
    onselfclosingtag(end) {
        const name = currentOpenTag!.tag
        currentOpenTag!.isSelfClosing = true
        endOpenTag(end)
        if (stack[0] && stack[0].tag === name) {
            onCloseTag(stack.shift()!, end)
        }
    },
    onattribname(start, end) {
        // plain attribute
        currentProp = {
            type: NodeTypes.ATTRIBUTE,
            name: getSlice(start, end),
            nameLoc: getLoc(start, end),
            value: undefined,
            loc: getLoc(start),
        }
    },
    ondirname(start, end) {
        const raw = getSlice(start, end)
        const name = raw === '.' || raw === ':' ? 'bind' : raw === '@' ? 'on' : raw === '#' ? 'slot' : raw.slice(2)

        if (name === '') {
            emitError(ErrorCodes.X_MISSING_DIRECTIVE_NAME, start)
        }

        if (name === '') {
            currentProp = {
                type: NodeTypes.ATTRIBUTE,
                name: raw,
                nameLoc: getLoc(start, end),
                value: undefined,
                loc: getLoc(start),
            }
        } else {
            currentProp = {
                type: NodeTypes.DIRECTIVE,
                name,
                rawName: raw,
                exp: undefined,
                arg: undefined,
                modifiers: raw === '.' ? [createSimpleExpression('prop')] : [],
                loc: getLoc(start),
            }

        }
    },
    ondirarg(start, end) {
        if (start === end) return
        const arg = getSlice(start, end)
        const isStatic = arg[0] !== '['
        const directive = currentProp as DirectiveNode
        directive.arg = createExp(isStatic ? arg : arg.slice(1, -1), isStatic, getLoc(start, end), isStatic ? ConstantTypes.CAN_STRINGIFY : ConstantTypes.NOT_CONSTANT)
    },
    ondirmodifier(start, end) {
        const directive = currentProp as DirectiveNode
        directive.modifiers.push(createSimpleExpression(getSlice(start, end), true, getLoc(start, end)))
    },
    onattribdata(start, end) {
        currentAttrValue += getSlice(start, end)
        if (currentAttrStartIndex < 0) currentAttrStartIndex = start
        currentAttrEndIndex = end
    },
    onattribentity(char, start, end) {
        currentAttrValue += char
        if (currentAttrStartIndex < 0) currentAttrStartIndex = start
        currentAttrEndIndex = end
    },
    onattribnameend(end) {
        const start = currentProp!.loc.start.offset
        const name = getSlice(start, end)
        if (currentProp!.type === NodeTypes.DIRECTIVE) {
            currentProp!.rawName = name
        }
        // check duplicate attrs
        if (
            currentOpenTag!.props.some(p => (p.type === NodeTypes.DIRECTIVE ? p.rawName : p.name) === name)
        ) {
            emitError(ErrorCodes.DUPLICATE_ATTRIBUTE, start)
        }
    },
    onattribend(quote, end) {
        if (currentOpenTag && currentProp) {
            // finalize end pos
            setLocEnd(currentProp.loc, end)

            if (quote !== QuoteType.NoValue) {

                if (currentProp.type === NodeTypes.ATTRIBUTE) {
                    // assign value

                    if (quote === QuoteType.Unquoted && !currentAttrValue) {
                        emitError(ErrorCodes.MISSING_ATTRIBUTE_VALUE, end)
                    }

                    currentProp!.value = {
                        type: NodeTypes.TEXT,
                        content: currentAttrValue,
                        loc:
                            quote === QuoteType.Unquoted ? getLoc(currentAttrStartIndex, currentAttrEndIndex) : getLoc(currentAttrStartIndex - 1, currentAttrEndIndex + 1),
                    }
                    if (
                        tokenizer.inSFARoot && currentOpenTag.tag === 'template' && currentProp.name === 'lang' && currentAttrValue && currentAttrValue !== 'html'
                    ) {
                        // SFA root template with preprocessor lang, force tokenizer to
                        // RCDATA mode
                        tokenizer.enterRCDATA(toCharCodes(`</template`), 0)
                    }
                } else {
                    // directive
                    let expParseMode = ExpParseMode.Normal
                    {
                        if (currentProp.name === 'for') {
                            expParseMode = ExpParseMode.Skip
                        } else if (currentProp.name === 'slot') {
                            expParseMode = ExpParseMode.Params
                        } else if (
                            currentProp.name === 'on' && currentAttrValue.includes(';')
                        ) {
                            expParseMode = ExpParseMode.Statements
                        }
                    }
                    const trimmed = currentAttrValue.trim()
                    const preserveRef = currentProp.name === 'bind' && isRawRefExpression(trimmed)
                    const expressionStart = preserveRef ? currentAttrStartIndex + currentAttrValue.indexOf('<') + 1 : currentAttrStartIndex
                    const expressionEnd = preserveRef ? currentAttrStartIndex + currentAttrValue.lastIndexOf('>') : currentAttrEndIndex
                    const sanitized = preserveRef ? { content: trimmed.slice(1, -1), ranges: [[0, trimmed.length - 2] as [number, number]] } : sanitizeRawRefMarkers(currentAttrValue)
                    currentProp.exp = createExp(sanitized.content, false, getLoc(expressionStart, expressionEnd), ConstantTypes.NOT_CONSTANT, expParseMode)
                    currentProp.exp.preserveRef = preserveRef
                    if (sanitized.ranges.length) currentProp.exp.rawRefRanges = sanitized.ranges
                    if (currentProp.name === 'for') {
                        currentProp.forParseResult = parseForExpression(currentProp.exp)
                    }

                }
            }
            currentOpenTag.props.push(currentProp)
        }
        currentAttrValue = ''
        currentAttrStartIndex = currentAttrEndIndex = -1
    },
    oncomment(start, end) {
        if (currentOptions.comments) {
            addNode({
                type: NodeTypes.COMMENT,
                content: getSlice(start, end),
                loc: getLoc(start - 4, end + 3),
            })
        }
    },
    onend() {
        const end = currentInput.length
        // EOF ERRORS
        if ((__DEV__ || !false) && tokenizer.state !== State.Text) {
            switch (tokenizer.state) {
                case State.BeforeTagName:
                case State.BeforeClosingTagName:
                    emitError(ErrorCodes.EOF_BEFORE_TAG_NAME, end)
                    break
                case State.Interpolation:
                case State.InterpolationClose:
                    emitError(ErrorCodes.X_MISSING_INTERPOLATION_END, tokenizer.sectionStart)
                    break
                case State.InCommentLike:
                    if (tokenizer.currentSequence === Sequences.CdataEnd) {
                        emitError(ErrorCodes.EOF_IN_CDATA, end)
                    } else {
                        emitError(ErrorCodes.EOF_IN_COMMENT, end)
                    }
                    break
                case State.InTagName:
                case State.InSelfClosingTag:
                case State.InClosingTagName:
                case State.BeforeAttrName:
                case State.InAttrName:
                case State.InDirName:
                case State.InDirArg:
                case State.InDirDynamicArg:
                case State.InDirModifier:
                case State.AfterAttrName:
                case State.BeforeAttrValue:
                case State.InAttrValueDq: // "
                case State.InAttrValueSq: // '
                case State.InAttrValueNq:
                    emitError(ErrorCodes.EOF_IN_TAG, end)
                    break
                default:
                    // console.log(tokenizer.state)
                    break
            }
        }
        for (let index = 0; index < stack.length; index++) {
            onCloseTag(stack[index], end - 1)
            emitError(ErrorCodes.X_MISSING_END_TAG, stack[index].loc.start.offset)
        }
    },
    oncdata(start, end) {
        if (stack[0].ns !== Namespaces.HTML) {
            onText(getSlice(start, end), start, end)
        } else {
            emitError(ErrorCodes.CDATA_IN_HTML_CONTENT, start - 9)
        }
    },
    onprocessinginstruction(start) {
        // ignore as we do not have runtime handling for this, only check error
        if ((stack[0] ? stack[0].ns : currentOptions.ns) === Namespaces.HTML) {
            emitError(ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME, start - 1)
        }
    },
})

// This regex doesn't cover the case if key or index aliases have destructuring,
// but those do not make sense in the first place, so this works in practice.
const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g

function parseForExpression(input: SimpleExpressionNode): ForParseResult | undefined {
    const loc = input.loc
    const exp = input.content
    const inMatch = exp.match(forAliasRE)
    if (!inMatch) return

    const [, LHS, RHS] = inMatch

    const createAliasExpression = (content: string, offset: number, asParam = false) => {
        const start = loc.start.offset + offset
        const end = start + content.length
        return createExp(content, false, getLoc(start, end), ConstantTypes.NOT_CONSTANT, asParam ? ExpParseMode.Params : ExpParseMode.Normal)
    }

    const result: ForParseResult = {
        source: createAliasExpression(RHS.trim(), exp.indexOf(RHS, LHS.length)),
        value: undefined,
        key: undefined,
        index: undefined,
        finalized: false,
    }

    let valueContent = LHS.trim().replace(stripParensRE, '').trim()
    const trimmedOffset = LHS.indexOf(valueContent)

    const iteratorMatch = valueContent.match(forIteratorRE)
    if (iteratorMatch) {
        valueContent = valueContent.replace(forIteratorRE, '').trim()

        const keyContent = iteratorMatch[1].trim()
        let keyOffset: number | undefined
        if (keyContent) {
            keyOffset = exp.indexOf(keyContent, trimmedOffset + valueContent.length)
            result.key = createAliasExpression(keyContent, keyOffset, true)
        }

        if (iteratorMatch[2]) {
            const indexContent = iteratorMatch[2].trim()

            if (indexContent) {
                result.index = createAliasExpression(indexContent, exp.indexOf(indexContent, result.key ? keyOffset! + keyContent.length : trimmedOffset + valueContent.length), true)
            }
        }
    }

    if (valueContent) {
        result.value = createAliasExpression(valueContent, trimmedOffset, true)
    }

    return result
}

function getSlice(start: number, end: number) {
    return currentInput.slice(start, end)
}

function endOpenTag(end: number) {
    if (tokenizer.inSFARoot) {
        // in SFA mode, generate locations for root-level tags' inner content.
        currentOpenTag!.innerLoc = getLoc(end + 1, end + 1)
    }
    addNode(currentOpenTag!)
    const { tag, ns } = currentOpenTag!
    if (ns === Namespaces.HTML && currentOptions.isPreTag(tag)) {
        inPre++
    }
    if (currentOptions.isVoidTag(tag)) {
        onCloseTag(currentOpenTag!, end)
    } else {
        stack.unshift(currentOpenTag!)
        if (ns === Namespaces.SVG || ns === Namespaces.MATH_ML) {
            tokenizer.inXML = true
        }
    }
    currentOpenTag = null
}

function onText(content: string, start: number, end: number) {

    const parent = stack[0] || currentRoot
    const lastNode = parent.children[parent.children.length - 1]
    if (lastNode && lastNode.type === NodeTypes.TEXT) {
        // merge
        lastNode.content += content
        setLocEnd(lastNode.loc, end)
    } else {
        parent.children.push({
            type: NodeTypes.TEXT,
            content,
            loc: getLoc(start, end),
        })
    }
}

function onCloseTag(el: ElementNode, end: number, isImplied = false) {
    // attach end position
    if (isImplied) {
        // implied close, end should be backtracked to close
        setLocEnd(el.loc, backTrack(end, CharCodes.Lt))
    } else {
        setLocEnd(el.loc, lookAhead(end, CharCodes.Gt) + 1)
    }

    if (tokenizer.inSFARoot) {
        // SFA root tag, resolve inner end
        if (el.children.length) {
            el.innerLoc!.end = extend({}, el.children[el.children.length - 1].loc.end)
        } else {
            el.innerLoc!.end = extend({}, el.innerLoc!.start)
        }
        el.innerLoc!.source = getSlice(el.innerLoc!.start.offset, el.innerLoc!.end.offset)
    }

    // refine element type
    const { tag, ns, children } = el
    if (tag === 'Slot') el.tagType = ElementTypes.SLOT
    else if (tag === 'Template') el.tagType = ElementTypes.TEMPLATE
    else if (isArrangable(el)) el.tagType = ElementTypes.ARRANGABLE

    // whitespace management
    if (!tokenizer.inRCDATA) {
        el.children = condenseWhitespace(children)
    }

    if (ns === Namespaces.HTML && currentOptions.isIgnoreNewlineTag(tag)) {
        // remove leading newline for <textarea> and <pre> per html spec
        // https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody
        const first = children[0]
        if (first && first.type === NodeTypes.TEXT) {
            first.content = first.content.replace(/^\r?\n/, '')
        }
    }

    if (ns === Namespaces.HTML && currentOptions.isPreTag(tag)) {
        inPre--
    }
    if (
        tokenizer.inXML && (stack[0] ? stack[0].ns : currentOptions.ns) === Namespaces.HTML
    ) {
        tokenizer.inXML = false
    }

    // 2.x compat / deprecation checks

}

function lookAhead(index: number, c: number) {
    let i = index
    while (currentInput.charCodeAt(i) !== c && i < currentInput.length - 1) i++
    return i
}

function backTrack(index: number, c: number) {
    let i = index
    while (currentInput.charCodeAt(i) !== c && i >= 0) i--
    return i
}

const specialTemplateDir = new Set(['if', 'else', 'else-if', 'for', 'slot'])
function isArrangable({ tag }: ElementNode): boolean {
    return isUpperCase(tag.charCodeAt(0))
}

function isUpperCase(c: number) {
    return c > 64 && c < 91
}

const windowsNewlineRE = /\r\n/g
function condenseWhitespace(nodes: TemplateChildNode[]): TemplateChildNode[] {
    const shouldCondense = currentOptions.whitespace !== 'preserve'
    let removedWhitespace = false
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.type === NodeTypes.TEXT) {
            if (!inPre) {
                if (isAllWhitespace(node.content)) {
                    const prev = nodes[i - 1] && nodes[i - 1].type
                    const next = nodes[i + 1] && nodes[i + 1].type
                    // Remove if:
                    // - the whitespace is the first or last node, or:
                    // - (condense mode) the whitespace is between two comments, or:
                    // - (condense mode) the whitespace is between comment and element, or:
                    // - (condense mode) the whitespace is between two elements AND contains newline
                    if (
                        !prev || !next || (shouldCondense && ((prev === NodeTypes.COMMENT && (next === NodeTypes.COMMENT || next === NodeTypes.ELEMENT)) || (prev === NodeTypes.ELEMENT && (next === NodeTypes.COMMENT || (next === NodeTypes.ELEMENT && hasNewlineChar(node.content))))))
                    ) {
                        removedWhitespace = true
                        nodes[i] = null as any
                    } else {
                        // Otherwise, the whitespace is condensed into a single space
                        node.content = ' '
                    }
                } else if (shouldCondense) {
                    // in condense mode, consecutive whitespaces in text are condensed
                    // down to a single space.
                    node.content = condense(node.content)
                }
            } else {
                // #6410 normalize windows newlines in <pre>:

                node.content = node.content.replace(windowsNewlineRE, '\n')
            }
        }
    }
    return removedWhitespace ? nodes.filter(Boolean) : nodes
}

function hasNewlineChar(str: string) {
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i)
        if (c === CharCodes.NewLine || c === CharCodes.CarriageReturn) {
            return true
        }
    }
    return false
}

function condense(str: string) {
    let ret = ''
    let prevCharIsWhitespace = false
    for (let i = 0; i < str.length; i++) {
        if (isWhitespace(str.charCodeAt(i))) {
            if (!prevCharIsWhitespace) {
                ret += ' '
                prevCharIsWhitespace = true
            }
        } else {
            ret += str[i]
            prevCharIsWhitespace = false
        }
    }
    return ret
}

function addNode(node: TemplateChildNode) {

    (stack[0] || currentRoot).children.push(node)
}

function getLoc(start: number, end?: number): SourceLocation {
    return {
        start: tokenizer.getPos(start),
        // @ts-expect-error allow late attachment
        end: end == null ? end : tokenizer.getPos(end),
        // @ts-expect-error allow late attachment
        source: end == null ? end : getSlice(start, end),
    }
}

export function cloneLoc(loc: SourceLocation): SourceLocation {
    return getLoc(loc.start.offset, loc.end.offset)
}

function setLocEnd(loc: SourceLocation, end: number) {
    loc.end = tokenizer.getPos(end)
    loc.source = getSlice(loc.start.offset, end)
}

function dirToAttr(dir: DirectiveNode): AttributeNode {
    const attr: AttributeNode = {
        type: NodeTypes.ATTRIBUTE,
        name: dir.rawName!,
        nameLoc: getLoc(dir.loc.start.offset, dir.loc.start.offset + dir.rawName!.length),
        value: undefined,
        loc: dir.loc,
    }
    if (dir.exp) {
        // account for quotes
        const loc = dir.exp.loc
        if (loc.end.offset < dir.loc.end.offset) {
            loc.start.offset--
            loc.start.column--
            loc.end.offset++
            loc.end.column++
        }
        attr.value = {
            type: NodeTypes.TEXT,
            content: (dir.exp as SimpleExpressionNode).content,
            loc,
        }
    }
    return attr
}

enum ExpParseMode {
    Normal,
    Params,
    Statements,
    Skip,
}

function createExp(content: SimpleExpressionNode['content'], isStatic: SimpleExpressionNode['isStatic'] = false, loc: SourceLocation, constType: ConstantTypes = ConstantTypes.NOT_CONSTANT, parseMode = ExpParseMode.Normal) {
    const exp = createSimpleExpression(content, isStatic, loc, constType)
    if (
        (!isStatic) && currentOptions.prefixIdentifiers && parseMode !== ExpParseMode.Skip && content.trim()
    ) {
        if (isSimpleIdentifier(content)) {
            exp.ast = null // fast path
            return exp
        }
        try {
            const plugins = currentOptions.expressionPlugins
            const options: BabelOptions = {
                plugins: plugins ? [...plugins, 'typescript'] : ['typescript'],
            }
            if (parseMode === ExpParseMode.Statements) {
                // a-on with multi-inline-statements, pad 1 char
                exp.ast = parse(` ${content} `, options).program
            } else if (parseMode === ExpParseMode.Params) {
                exp.ast = parseExpression(`(${content})=>{}`, options)
            } else {
                // normal exp, wrap with parens
                exp.ast = parseExpression(`(${content})`, options)
            }
        } catch (e: any) {
            exp.ast = false // indicate an error
            emitError(ErrorCodes.X_INVALID_EXPRESSION, loc.start.offset, e.message)
        }
    }
    return exp
}

function emitError(code: ErrorCodes, index: number, message?: string) {
    currentOptions.onError(createCompilerError(code, getLoc(index, index), undefined, message))
}

function reset() {
    tokenizer.reset()
    currentOpenTag = null
    currentProp = null
    currentAttrValue = ''
    currentAttrStartIndex = -1
    currentAttrEndIndex = -1
    stack.length = 0
}

export function baseParse(input: string, options?: ParserOptions): RootNode {
    reset()
    currentInput = input
    currentOptions = extend({}, defaultParserOptions)

    if (options) {
        let key: keyof ParserOptions
        for (key in options) {
            if (options[key] != null) {
                // @ts-expect-error
                currentOptions[key] = options[key]
            }
        }
    }

    if (__DEV__) {
        if ((currentOptions.decodeEntities)) {
            console.warn(`[@arrange/compiler/core] decodeEntities option is passed but will be ` + `ignored in non-browser builds.`)
        }
    }

    tokenizer.mode = currentOptions.parseMode === 'html' ? ParseMode.HTML : currentOptions.parseMode === 'sfa' ? ParseMode.SFA : ParseMode.BASE

    tokenizer.inXML = currentOptions.ns === Namespaces.SVG || currentOptions.ns === Namespaces.MATH_ML

    const delimiters = options && options.delimiters
    if (delimiters) {
        tokenizer.delimiterOpen = toCharCodes(delimiters[0])
        tokenizer.delimiterClose = toCharCodes(delimiters[1])
    }

    const root = (currentRoot = createRoot([], input))
    tokenizer.parse(currentInput)
    root.loc = getLoc(0, input.length)
    root.children = condenseWhitespace(root.children)
    currentRoot = null
    return root
}

// 先识别完整 TS 表达式，类型断言与泛型实例化不能被误当作原样标记
function isRawRefExpression(expression: string): boolean {
    if (!expression.startsWith('<') || !expression.endsWith('>')) return false

    try {
        parseExpression(expression, { plugins: ['typescript'] })
        return false
    } catch {
        // 外层不是合法 TS 时，仅剥离一对标记；内部仍由正式表达式解析器校验
        return true
    }
}

function sanitizeRawRefMarkers(expression: string): { content: string; ranges: [number, number][] } {
    const output = expression.split('')
    const ranges: [number, number][] = []
    for (let index = 0; index < expression.length; index++) {
        if (expression[index] !== '<') continue
        let depth = 0
        let quote = ''
        let close = -1
        for (let cursor = index + 1; cursor < expression.length; cursor++) {
            const character = expression[cursor]
            if (quote) {
                if (character === quote && expression[cursor - 1] !== '\\') quote = ''
                continue
            }
            // 这几行代码与“packages/compiler/src/core/transforms/transformExpression.ts”有重复
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
        const inner = expression.slice(index + 1, close)
        const previous = expression.slice(0, index).trimEnd().slice(-1)
        const following = expression.slice(close + 1).trimStart()[0] ?? ''
        if (close < 0 || !inner.trim() || /[<>]/.test(inner) || previous && /[\w$).\]]/.test(previous) || /[\w$.(\[]/.test(following)) continue
        ranges.push([index + 1, close])
        output[index] = ' '
        output[close] = ' '
        index = close
    }
    return { content: output.join(''), ranges }
}