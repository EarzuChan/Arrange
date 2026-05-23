export const version: string = __VERSION__

// API
export { parse } from './parse.ts'
export { compileTemplate } from './compileTemplate.ts'
export { compileStyle, compileStyleAsync } from './compileStyle.ts'
export { compileScript } from './compileScript.ts'
export { rewriteDefault, rewriteDefaultAST } from './rewriteDefault.ts'
export { resolveTypeElements, inferRuntimeType } from './script/resolveType.ts'

import { type SFCParseResult, parseCache as _parseCache } from './parse.ts'
// #9521 export parseCache as a simple map to avoid exposing LRU types
export const parseCache = _parseCache as Map<string, SFCParseResult>

// error messages
import {
  DOMErrorMessages,
  errorMessages as coreErrorMessages,
} from '@arrange/vue-compiler-arrange'

export const errorMessages: Record<number, string> = {
  ...coreErrorMessages,
  ...DOMErrorMessages,
}

// Utilities
export { parse as babelParse } from '@babel/parser'
import MagicString from 'magic-string'
export { MagicString }
// technically internal but we want it in @vue/repl, cast it as any to avoid
// relying on estree types
import { walk as _walk } from 'estree-walker'
export const walk = _walk as any
export {
  generateCodeFrame,
  walkIdentifiers,
  extractIdentifiers,
  isInDestructureAssignment,
  isStaticProperty,
} from '@arrange/vue-compiler-core'

// Internals for type resolution
export { invalidateTypeCache, registerTS } from './script/resolveType.ts'
export { extractRuntimeProps } from './script/defineProps.ts'
export { extractRuntimeEmits } from './script/defineEmits.ts'

// Types
export type {
  SFCParseOptions,
  SFCParseResult,
  SFCDescriptor,
  SFCBlock,
  SFCTemplateBlock,
  SFCScriptBlock,
  SFCStyleBlock,
} from './parse.ts'
export type {
  TemplateCompiler,
  SFCTemplateCompileOptions,
  SFCTemplateCompileResults,
} from './compileTemplate.ts'
export type {
  SFCStyleCompileOptions,
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileResults,
} from './compileStyle.ts'
export type { SFCScriptCompileOptions } from './compileScript.ts'
export type { ScriptCompileContext } from './script/context.ts'
export type {
  TypeResolveContext,
  SimpleTypeResolveOptions,
  SimpleTypeResolveContext,
} from './script/resolveType.ts'
export type {
  AssetURLOptions,
  AssetURLTagConfig,
} from './template/transformAssetUrl.ts'
export type {
  CompilerOptions,
  CompilerError,
  BindingMetadata,
} from '@arrange/vue-compiler-core'

/**
 * @deprecated this is preserved to avoid breaking vite-plugin-vue < 5.0
 * with reactivityTransform: true. The desired behavior should be silently
 * ignoring the option instead of breaking.
 */
export const shouldTransformRef = () => false

