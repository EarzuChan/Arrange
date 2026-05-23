import {
  type CodegenResult,
  type CompilerOptions,
  type DirectiveTransform,
  type NodeTransform,
  type ParserOptions,
  type RootNode,
  baseCompile,
  baseParse,
  noopDirectiveTransform,
} from '@arrange/vue-compiler-core'
import { parserOptions } from './parserOptions.ts'
import { transformStyle } from './transforms/transformStyle.ts'
import { transformVHtml } from './transforms/vHtml.ts'
import { transformVText } from './transforms/vText.ts'
import { transformModel } from './transforms/vModel.ts'
import { transformOn } from './transforms/vOn.ts'
import { transformShow } from './transforms/vShow.ts'
import { transformTransition } from './transforms/Transition.ts'
import { stringifyStatic } from './transforms/stringifyStatic.ts'
import { ignoreSideEffectTags } from './transforms/ignoreSideEffectTags.ts'
import { validateHtmlNesting } from './transforms/validateHtmlNesting.ts'
import { extend } from '@arrange/vue-shared'

export { parserOptions }

export const DOMNodeTransforms: NodeTransform[] = [
  transformStyle,
  ...(__DEV__ ? [transformTransition, validateHtmlNesting] : []),
]

export const DOMDirectiveTransforms: Record<string, DirectiveTransform> = {
  cloak: noopDirectiveTransform,
  html: transformVHtml,
  text: transformVText,
  model: transformModel, // override compiler-core
  on: transformOn, // override compiler-core
  show: transformShow,
}

export function compile(
  src: string | RootNode,
  options: CompilerOptions = {},
): CodegenResult {
  return baseCompile(
    src,
    extend({}, parserOptions, options, {
      nodeTransforms: [
        // ignore <script> and <tag>
        // this is not put inside DOMNodeTransforms because that list is used
        // by compiler-ssr to generate vnode fallback branches
        ignoreSideEffectTags,
        ...DOMNodeTransforms,
        ...(options.nodeTransforms || []),
      ],
      directiveTransforms: extend(
        {},
        DOMDirectiveTransforms,
        options.directiveTransforms || {},
      ),
      transformHoist: __BROWSER__ ? null : stringifyStatic,
    }),
  )
}

export function parse(template: string, options: ParserOptions = {}): RootNode {
  return baseParse(template, extend({}, parserOptions, options))
}

export * from './runtimeHelpers.ts'
export { transformStyle } from './transforms/transformStyle.ts'
export {
  createDOMCompilerError,
  DOMErrorCodes,
  DOMErrorMessages,
} from './errors.ts'
export * from '@arrange/vue-compiler-core'

