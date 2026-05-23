export { baseCompile } from './compile.ts'

// Also expose lower level APIs & types
export {
  type CompilerOptions,
  type ParserOptions,
  type TransformOptions,
  type CodegenOptions,
  type HoistTransform,
  type BindingMetadata,
  BindingTypes,
} from './options.ts'
export { baseParse } from './parser.ts'
export {
  transform,
  type TransformContext,
  createTransformContext,
  traverseNode,
  createStructuralDirectiveTransform,
  type NodeTransform,
  type StructuralDirectiveTransform,
  type DirectiveTransform,
} from './transform.ts'
export {
  generate,
  type CodegenContext,
  type CodegenResult,
  type CodegenSourceMapGenerator,
  type RawSourceMap,
} from './codegen.ts'
export {
  ErrorCodes,
  errorMessages,
  createCompilerError,
  type CoreCompilerError,
  type CompilerError,
} from './errors.ts'

export * from './ast.ts'
export * from './utils.ts'
export * from './babelUtils.ts'
export * from './runtimeHelpers.ts'

export { getBaseTransformPreset, type TransformPreset } from './compile.ts'
export { transformModel } from './transforms/vModel.ts'
export { transformOn } from './transforms/vOn.ts'
export { transformBind } from './transforms/vBind.ts'
export { noopDirectiveTransform } from './transforms/noopDirectiveTransform.ts'
export { processIf } from './transforms/vIf.ts'
export { processFor, createForLoopParams } from './transforms/vFor.ts'
export {
  transformExpression,
  processExpression,
  stringifyExpression,
} from './transforms/transformExpression.ts'
export {
  buildSlots,
  type SlotFnBuilder,
  trackVForSlotScopes,
  trackSlotScopes,
} from './transforms/vSlot.ts'
export {
  transformElement,
  resolveComponentType,
  buildProps,
  buildDirectiveArgs,
  type PropsExpression,
} from './transforms/transformElement.ts'
export { transformVBindShorthand } from './transforms/transformVBindShorthand.ts'
export { processSlotOutlet } from './transforms/transformSlotOutlet.ts'
export { getConstantType } from './transforms/cacheStatic.ts'
export { generateCodeFrame } from '@arrange/vue-shared'

// v2 compat only
export {
  checkCompatEnabled,
  warnDeprecation,
  CompilerDeprecationTypes,
} from './compat/compatConfig.ts'

