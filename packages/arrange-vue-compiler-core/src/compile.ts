import type { RootNode } from './ast.ts'
import type { CompilerOptions } from './options.ts'
import { baseParse } from './parser.ts'
import { generate, type CodegenResult } from './codegen.ts'

export function baseCompile(source: string | RootNode, options: CompilerOptions = {}): CodegenResult {
    return generate(typeof source === 'string' ? baseParse(source, options) : source, options)
}
