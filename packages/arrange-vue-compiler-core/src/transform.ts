import type { ParserPlugin } from '@babel/parser'
import type { BindingMetadata } from './options.ts'
import type { CompilerError } from './errors.ts'
import type { TemplateChildNode } from './ast.ts'

export interface TransformContext {
    readonly prefixIdentifiers: boolean
    readonly inline: boolean
    readonly isTS: boolean
    readonly bindingMetadata: BindingMetadata
    readonly identifiers: Record<string, number>
    readonly expressionPlugins: ParserPlugin[]
    onError(error: CompilerError): void
    helperString(helper: symbol): string
}

export type NodeTransform = (node: TemplateChildNode, context: TransformContext) => void
