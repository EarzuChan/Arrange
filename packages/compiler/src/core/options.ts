import type { ParserPlugin } from '@babel/parser'
import type { ElementNode, Namespace, Namespaces } from './ast.ts'
import type { CompilerError } from './errors.ts'


export interface ErrorHandlingOptions {
    onWarn?: (warning: CompilerError) => void
    onError?: (error: CompilerError) => void
}

export interface ParserOptions
    extends ErrorHandlingOptions {

    parseMode?: 'base' | 'html' | 'sfa'

    ns?: Namespaces
    isVoidTag?: (tag: string) => boolean
    isPreTag?: (tag: string) => boolean
    isIgnoreNewlineTag?: (tag: string) => boolean
    getNamespace?: (tag: string, parent: ElementNode | undefined, rootNamespace: Namespace) => Namespace
    delimiters?: [string, string]
    whitespace?: 'preserve' | 'condense'

    comments?: boolean
    prefixIdentifiers?: boolean
    expressionPlugins?: ParserPlugin[]
}

export enum BindingTypes {
    PROPS = 'props',
    PROPS_ALIASED = 'props-aliased',
    SETUP_LET = 'setup-let',
    SETUP_CONST = 'setup-const',
    SETUP_REACTIVE_CONST = 'setup-reactive-const',
    SETUP_MAYBE_REF = 'setup-maybe-ref',
    SETUP_REF = 'setup-ref',
    LITERAL_CONST = 'literal-const',
}

export type BindingMetadata = {
    [key: string]: BindingTypes | undefined
} & {
    __propsAliases?: Record<string, string>
    __arrangeModifierRoots?: string[]
}

export interface CompilerOptions extends ParserOptions {
    inline?: boolean
    mode?: 'module' | 'function'
    isTS?: boolean
    bindingMetadata?: BindingMetadata
    runtimeModuleName?: string
    sourceMap?: boolean
    filename?: string
    hoistStatic?: boolean
    hmr?: boolean
    arrangeTypecheck?: boolean
}
export type CodegenOptions = CompilerOptions
