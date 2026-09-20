
export const version: string = __VERSION__

// API
export { compileScript } from './compileScript.ts'
export { compileTemplate } from './compileTemplate.ts'
export { parse } from './parse.ts'
export { inferRuntimeType, resolveTypeElements } from './script/resolveType.ts'

import { type SFAParseResult, parseCache as _parseCache } from './parse.ts'

// #9521 export parseCache as a simple map to avoid exposing LRU types
export const parseCache = _parseCache as Map<string, SFAParseResult>

// error messages
import {
    errorMessages as coreErrorMessages,
} from '@arrange/vue-compiler-arrange'
import MagicString from 'magic-string'

export const errorMessages: Record<number, string> = {
    ...coreErrorMessages,
}

// Utilities
export { parse as babelParse } from '@babel/parser'
export { MagicString }

// technically internal but we want it in @vue/repl, cast it as any to avoid
// relying on estree types
import { walk as _walk } from 'estree-walker'
export const walk = _walk as any
export {
    extractIdentifiers, generateCodeFrame, isInDestructureAssignment,
    isStaticProperty, walkIdentifiers
} from '@arrange/vue-compiler-core'

// Internals for type resolution
export { extractRuntimeProps } from './script/defineProps.ts'
export { invalidateTypeCache, registerTS } from './script/resolveType.ts'

// Types
export type {
    BindingMetadata, CompilerError, CompilerOptions
} from '@arrange/vue-compiler-core'
export type { SFAScriptCompileOptions } from './compileScript.ts'
export type {
    SFATemplateCompileOptions,
    SFATemplateCompileResults, TemplateCompiler
} from './compileTemplate.ts'
export type {
    SFABlock, SFADescriptor, SFAParseOptions,
    SFAParseResult, SFAScriptBlock, SFATemplateBlock
} from './parse.ts'
export type { ScriptCompileContext } from './script/context.ts'
export type {
    SimpleTypeResolveContext, SimpleTypeResolveOptions, TypeResolveContext
} from './script/resolveType.ts'
