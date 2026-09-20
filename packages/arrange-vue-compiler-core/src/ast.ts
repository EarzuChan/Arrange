import type { Node as BabelNode } from "@babel/types"
// 模板 AST 只服务于语法解析与编译，不参与运行期重排
export type Namespace = number

// 我真应该肃清你了，什么叫HTML？
export enum Namespaces {
    HTML,
    SVG,
    MATH_ML,
}

export enum NodeTypes {
    ROOT,
    ELEMENT,
    TEXT,
    COMMENT,
    SIMPLE_EXPRESSION,
    INTERPOLATION,
    ATTRIBUTE,
    DIRECTIVE,
    COMPOUND_EXPRESSION,
}

export enum ElementTypes {
    ELEMENT,
    ARRANGABLE,
    SLOT,
    TEMPLATE,
}

export interface Node {
    type: NodeTypes
    loc: SourceLocation
}

// The node's range. The `start` is inclusive and `end` is exclusive.
// [start, end)
export interface SourceLocation {
    start: Position
    end: Position
    source: string
}

export interface Position {
    offset: number // from start of file
    line: number
    column: number
}

export type ParentNode = RootNode | ElementNode

export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

export type TemplateChildNode =
    | ElementNode
    | InterpolationNode
    | CompoundExpressionNode
    | TextNode
    | CommentNode

export interface RootNode extends Node {
    slotNames?: readonly string[]
    type: NodeTypes.ROOT
    source: string
    children: TemplateChildNode[]
    helpers: Set<symbol>
    arrangables: string[]
    transformed?: boolean

}

export type ElementNode =
    | PlainElementNode
    | ArrangableNode
    | SlotOutletNode
    | TemplateNode

export interface BaseElementNode extends Node {
    type: NodeTypes.ELEMENT
    ns: Namespace
    tag: string
    tagType: ElementTypes
    props: Array<AttributeNode | DirectiveNode>
    children: TemplateChildNode[]
    isSelfClosing?: boolean
    innerLoc?: SourceLocation // only for SFA root level elements
}

export interface PlainElementNode extends BaseElementNode { tagType: ElementTypes.ELEMENT }
export interface ArrangableNode extends BaseElementNode { tagType: ElementTypes.ARRANGABLE }
export interface SlotOutletNode extends BaseElementNode { tagType: ElementTypes.SLOT }
export interface TemplateNode extends BaseElementNode { tagType: ElementTypes.TEMPLATE }

export interface TextNode extends Node {
    type: NodeTypes.TEXT
    content: string
}

export interface CommentNode extends Node {
    type: NodeTypes.COMMENT
    content: string
}

export interface AttributeNode extends Node {
    type: NodeTypes.ATTRIBUTE
    name: string
    nameLoc: SourceLocation
    value: TextNode | undefined
}

export interface DirectiveNode extends Node {
    type: NodeTypes.DIRECTIVE
    /**
     * the normalized name without prefix or shorthands, e.g. "bind", "on"
     */
    name: string
    /**
     * the raw attribute name, preserving shorthand, and including arg & modifiers
     * this is only used during parse.
     */
    rawName?: string
    exp: ExpressionNode | undefined
    arg: ExpressionNode | undefined
    modifiers: SimpleExpressionNode[]
    /**
     * optional property to cache the expression parse result for v-for
     */
    forParseResult?: ForParseResult
}

/**
 * Static types have several levels.
 * Higher levels implies lower levels. e.g. a node that can be stringified
 * can be reused by expression consumers.
 */
export enum ConstantTypes {
    NOT_CONSTANT = 0,
    CAN_REUSE_VALUE,
    CAN_CACHE,
    CAN_STRINGIFY,
}

export interface SimpleExpressionNode extends Node {
    type: NodeTypes.SIMPLE_EXPRESSION
    content: string
    isStatic: boolean
    constType: ConstantTypes
    /**
     * - `null` means the expression is a simple identifier that doesn't need
     *    parsing
     * - `false` means there was a parsing error
     */
    ast?: BabelNode | null | false
    /**
     * an expression parsed as the params of a function will track
     * the identifiers declared inside the function body.
     */
    identifiers?: string[]
    preserveRef?: boolean
}

export interface InterpolationNode extends Node {
    type: NodeTypes.INTERPOLATION
    content: ExpressionNode
}

export interface CompoundExpressionNode extends Node {
    type: NodeTypes.COMPOUND_EXPRESSION
    /**
     * - `null` means the expression is a simple identifier that doesn't need
     *    parsing
     * - `false` means there was a parsing error
     */
    ast?: BabelNode | null | false
    children: (
        | SimpleExpressionNode
        | CompoundExpressionNode
        | InterpolationNode
        | TextNode
        | string
        | symbol
    )[]

    /**
     * an expression parsed as the params of a function will track
     * the identifiers declared inside the function body.
     */
    identifiers?: string[]
}

export interface ForParseResult {
    source: ExpressionNode
    value: ExpressionNode | undefined
    key: ExpressionNode | undefined
    index: ExpressionNode | undefined
    finalized: boolean
}

export type TemplateTextChildNode =
    | TextNode
    | InterpolationNode
    | CompoundExpressionNode


export const locStub: SourceLocation = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 }, source: '' }

export function createRoot(children: TemplateChildNode[], source = ''): RootNode {
    return { type: NodeTypes.ROOT, source, children, helpers: new Set(), arrangables: [], loc: locStub }
}

export function createSimpleExpression(content: string, isStatic = false, loc: SourceLocation = locStub, constType = ConstantTypes.NOT_CONSTANT): SimpleExpressionNode {
    return { type: NodeTypes.SIMPLE_EXPRESSION, content, isStatic, loc, constType: isStatic ? ConstantTypes.CAN_STRINGIFY : constType }
}

export function createCompoundExpression(children: CompoundExpressionNode['children'], loc: SourceLocation = locStub): CompoundExpressionNode {
    return { type: NodeTypes.COMPOUND_EXPRESSION, children, loc }
}
