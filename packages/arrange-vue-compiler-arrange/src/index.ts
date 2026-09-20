import { baseCompile, baseParse, type CodegenResult, type CompilerOptions, type ParserOptions, type RootNode } from '@arrange/vue-compiler-core'
import { parserOptions } from './parserOptions.ts'
import { validateTemplateContract } from './templateContract.ts'

export { parserOptions, validateTemplateContract }

export function compile(source: string | RootNode, options: CompilerOptions = {}): CodegenResult {
    const resolved = { ...parserOptions, ...options, isTS: true }
    const ast = typeof source === 'string' ? baseParse(source, resolved) : source
    ast.slotNames = validateTemplateContract(ast, resolved)
    return baseCompile(ast, resolved)
}

export function parse(template: string, options: ParserOptions = {}): RootNode {
    return baseParse(template, { ...parserOptions, ...options })
}

export * from '@arrange/vue-compiler-core'
