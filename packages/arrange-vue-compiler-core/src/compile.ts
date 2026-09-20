import { isString } from '@arrange/vue-shared'
import type { RootNode } from './ast.ts'
import { type CodegenResult, generate } from './codegen.ts'
import type { CompilerOptions } from './options.ts'
import { baseParse } from './parser.ts'
import { type NodeTransform, transform } from './transform.ts'
import { transformElement } from './transforms/transformElement.ts'
import { transformExpression } from './transforms/transformExpression.ts'
import { transformSlotOutlet } from './transforms/transformSlotOutlet.ts'
import { transformFor } from './transforms/vFor.ts'
import { transformIf } from './transforms/vIf.ts'
import { trackSlotScopes, trackVForSlotScopes } from './transforms/vSlot.ts'

export type TransformPreset = NodeTransform[]

export function getBaseTransformPreset(prefixIdentifiers?: boolean): TransformPreset {
    return [transformIf, transformFor, ...(prefixIdentifiers ? [trackVForSlotScopes, transformExpression] : []), transformSlotOutlet, transformElement, trackSlotScopes]
}

// 模板只执行固定语法转换，调用方不能注册额外指令解释器
export function baseCompile(source: string | RootNode, options: CompilerOptions = {}): CodegenResult {
    const prefixIdentifiers = options.prefixIdentifiers === true || options.mode === 'module'
    const expressionPlugins = options.isTS && !options.expressionPlugins?.includes('typescript') ? [...(options.expressionPlugins ?? []), 'typescript' as const] : options.expressionPlugins
    const resolved = { ...options, prefixIdentifiers, expressionPlugins }
    const ast = isString(source) ? baseParse(source, resolved) : source
    transform(ast, { ...resolved, nodeTransforms: getBaseTransformPreset(prefixIdentifiers) })
    return generate(ast, resolved)
}
