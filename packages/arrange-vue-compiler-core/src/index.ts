
export { baseCompile } from './compile.ts'

// Also expose lower level APIs & types
export {
    type CodegenContext,
    type CodegenResult,
    type CodegenSourceMapGenerator,
    type RawSourceMap, generate
} from './codegen.ts'
export {
    type CompilerError, type CoreCompilerError, ErrorCodes, createCompilerError, errorMessages
} from './errors.ts'
export {
    type BindingMetadata,
    BindingTypes, type CodegenOptions, type CompilerOptions, type HoistTransform, type ParserOptions,
    type TransformOptions
} from './options.ts'
export { baseParse } from './parser.ts'
export {
    type DirectiveTransform, type NodeTransform,
    type StructuralDirectiveTransform, type TransformContext, createStructuralDirectiveTransform, createTransformContext, transform, traverseNode
} from './transform.ts'

export * from './ast.ts'
export * from './babelUtils.ts'
export * from './runtimeHelpers.ts'
export * from './utils.ts'

export { generateCodeFrame } from '@arrange/vue-shared'
export { type TransformPreset, getBaseTransformPreset } from './compile.ts'
export { getConstantType } from './transforms/cacheStatic.ts'
export { noopDirectiveTransform } from './transforms/noopDirectiveTransform.ts'
export {
    type PropsExpression, buildDirectiveArgs, buildProps, resolveComponentType, transformElement
} from './transforms/transformElement.ts'
export {
    processExpression,
    stringifyExpression, transformExpression
} from './transforms/transformExpression.ts'
export { processSlotOutlet } from './transforms/transformSlotOutlet.ts'
export { transformVBindShorthand } from './transforms/transformVBindShorthand.ts'
export { transformBind } from './transforms/vBind.ts'
export { createForLoopParams, processFor } from './transforms/vFor.ts'
export { processIf } from './transforms/vIf.ts'
export { transformModel } from './transforms/vModel.ts'
export { transformOn } from './transforms/vOn.ts'
export {
    type SlotFnBuilder, buildSlots, trackSlotScopes, trackVForSlotScopes
} from './transforms/vSlot.ts'
