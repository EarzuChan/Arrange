import type { TransformContext } from './transform.ts'
import type { ParserPlugin } from '@babel/parser'
import type {ElementNode, Namespace, Namespaces, ParentNode, TemplateChildNode,} from './ast.ts'
import type { CompilerError } from './errors.ts'


export interface ErrorHandlingOptions {
    onWarn?: (warning: CompilerError) => void
    onError?: (error: CompilerError) => void
}

export interface ParserOptions
    extends ErrorHandlingOptions {

    parseMode?: 'base' | 'html' | 'sfa'

    ns?: Namespaces
    /**
     * e.g. platform native elements, e.g. `<div>` for browsers
     */
    isNativeTag?: (tag: string) => boolean
    /**
     * e.g. native elements that can self-close, e.g. `<img>`, `<br>`, `<hr>`
     */
    isVoidTag?: (tag: string) => boolean
    /**
     * e.g. elements that should preserve whitespace inside, e.g. `<pre>`
     */
    isPreTag?: (tag: string) => boolean
    /**
     * Elements that should ignore the first newline token per parinsg spec
     * e.g. `<textarea>` and `<pre>`
     */
    isIgnoreNewlineTag?: (tag: string) => boolean
    /**
     * Platform-specific built-in arrangables e.g. `<Transition>`
     */
    isBuiltInArrangable?: (tag: string) => symbol | void
    /**
     * Get tag namespace
     */
    getNamespace?: (
        tag: string,
        parent: ElementNode | undefined,
        rootNamespace: Namespace,
    ) => Namespace
    /**
     * @default ['{{', '}}']
     */
    delimiters?: [string, string]
    /**
     * Whitespace handling strategy
     * @default 'condense'
     */
    whitespace?: 'preserve' | 'condense'

    decodeEntities?: (rawText: string, asAttr: boolean) => string
    /**
     * Whether to keep comments in the templates AST.
     * This defaults to `true` in development and `false` in production builds.
     */
    comments?: boolean
    /**
     * Parse JavaScript expressions with Babel.
     * @default false
     */
    prefixIdentifiers?: boolean
    /**
     * A list of parser plugins to enable for `@babel/parser`, which is used to
     * parse expressions in bindings and interpolations.
     * https://babeljs.io/docs/en/next/babel-parser#plugins
     */
    expressionPlugins?: ParserPlugin[]
}

export type HoistTransform = (
    children: TemplateChildNode[],
    context: TransformContext,
    parent: ParentNode,
) => void

export enum BindingTypes {
    /**
     * declared as a prop
     */
    PROPS = 'props',
    /**
     * a local alias of a `<script setup>` destructured prop.
     * the original is stored in __propsAliases of the bindingMetadata object.
     */
    PROPS_ALIASED = 'props-aliased',
    /**
     * a let binding (may or may not be a ref)
     */
    SETUP_LET = 'setup-let',
    /**
     * a const binding that can never be a ref.
     * these bindings don't need `unref()` calls when processed in inlined
     * template expressions.
     */
    SETUP_CONST = 'setup-const',
    /**
     * a const binding that does not need `unref()`, but may be mutated.
     */
    SETUP_REACTIVE_CONST = 'setup-reactive-const',
    /**
     * a const binding that may be a ref.
     */
    SETUP_MAYBE_REF = 'setup-maybe-ref',
    /**
     * bindings that are guaranteed to be refs
     */
    SETUP_REF = 'setup-ref',
    /**
     * a literal constant, e.g. 'foo', 1, true
     */
    LITERAL_CONST = 'literal-const',
}

export type BindingMetadata = {
    [key: string]: BindingTypes | undefined
} & {
    __isScriptSetup?: boolean
    __propsAliases?: Record<string, string>
    __arrangeModifierRoots?: string[]
}

interface SharedTransformCodegenOptions {
    /**
     * Transform expressions like {{ foo }} to `_ctx.foo`.
     * If this option is false, the generated code will be wrapped in a
     * `with (this) { ... }` block.
     * - This is force-enabled in module mode, since modules are by default strict
     * and cannot use `with`
     * @default mode === 'module'
     */
    prefixIdentifiers?: boolean

    /**
     * Optional binding metadata analyzed from script - used to optimize
     * binding access when `prefixIdentifiers` is enabled.
     */
    bindingMetadata?: BindingMetadata
    /**
     * Compile the function for inlining inside setup().
     * This allows the function to directly access setup() local bindings.
     */
    inline?: boolean
    /**
     * Indicates that transforms and codegen should try to output valid TS code
     */
    isTS?: boolean

    filename?: string
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
