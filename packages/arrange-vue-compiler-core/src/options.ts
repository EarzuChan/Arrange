import type { ParserPlugin } from '@babel/parser'
import type {
    ElementNode,
    Namespace,
    Namespaces,
    ParentNode,
    TemplateChildNode,
} from './ast.ts'
import type { CompilerError } from './errors.ts'
import type {
    DirectiveTransform,
    NodeTransform,
    TransformContext,
} from './transform.ts'

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

export interface TransformOptions
    extends
    SharedTransformCodegenOptions,
    ErrorHandlingOptions {
    arrangeTypecheck?: boolean
    /**
     * An array of node transforms to be applied to every AST node.
     */
    nodeTransforms?: NodeTransform[]

    /**
     * If the pairing runtime provides additional built-in elements, use this to
     * mark them as built-in so the compiler will generate arrangable vnodes
     * for them.
     */
    isBuiltInArrangable?: (tag: string) => symbol | void
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
     * Cache static VNodes and props objects to `_hoisted_x` constants
     * @default false
     */
    hoistStatic?: boolean
    /**
     * A list of parser plugins to enable for `@babel/parser`, which is used to
     * parse expressions in bindings and interpolations.
     * https://babeljs.io/docs/en/next/babel-parser#plugins
     */
    expressionPlugins?: ParserPlugin[]
    /**
     * SFA scoped styles ID
     */

    /**
     * Indicates this SFA template has used :slotted in its styles
     * Defaults to `true` for backwards compatibility - SFA tooling should set it
     * to `false` if no `:slotted` usage is detected in `<style>`
     */

    /**
     * Whether to compile the template assuming it needs to handle HMR.
     * Some edge cases may need to generate different code for HMR to work
     * correctly, e.g. #6938, #7138
     */
    hmr?: boolean
}

export interface CodegenOptions extends SharedTransformCodegenOptions {
    /**
     * - `module` mode will generate ES module import statements for helpers
     * and export the render function as the default export.
     * - `function` mode will generate a single `const { helpers... } = Vue`
     * statement and return the render function. It expects `Vue` to be globally
     * available (or passed by wrapping the code with an IIFE). It is meant to be
     * used with `new Function(code)()` to generate a render function at runtime.
     * @default 'function'
     */
    mode?: 'module' | 'function'
    /**
     * Generate source map?
     * @default false
     */
    sourceMap?: boolean
    /**
     * SFA scoped styles ID
     */

    /**
     * Option to optimize helper import bindings via variable assignment
     * (only used for webpack code-split)
     * @default false
     */
    optimizeImports?: boolean
    /**
     * Customize where to import runtime helpers from.
     * @default 'vue'
     */
    runtimeModuleName?: string

    /**
     * Customize the global variable name of `Vue` to get helpers from
     * in function mode
     * @default 'Vue'
     */
    runtimeGlobalName?: string
}

export type CompilerOptions = ParserOptions & Omit<TransformOptions, 'nodeTransforms'> & CodegenOptions
