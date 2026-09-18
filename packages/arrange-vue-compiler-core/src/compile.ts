import { extend, isString } from '@arrange/vue-shared'
import type { RootNode } from './ast.ts'
import { type CodegenResult, generate } from './codegen.ts'
import { ErrorCodes, createCompilerError, defaultOnError } from './errors.ts'
import type { CompilerOptions } from './options.ts'
import { baseParse } from './parser.ts'
import {
    type DirectiveTransform,
    type NodeTransform,
    transform,
} from './transform.ts'
import { transformElement } from './transforms/transformElement.ts'
import { transformExpression } from './transforms/transformExpression.ts'
import { transformSlotOutlet } from './transforms/transformSlotOutlet.ts'
import { transformText } from './transforms/transformText.ts'
import { transformVBindShorthand } from './transforms/transformVBindShorthand.ts'
import { transformBind } from './transforms/vBind.ts'
import { transformFor } from './transforms/vFor.ts'
import { transformIf } from './transforms/vIf.ts'
import { transformMemo } from './transforms/vMemo.ts'
import { transformModel } from './transforms/vModel.ts'
import { transformOn } from './transforms/vOn.ts'
import { transformOnce } from './transforms/vOnce.ts'
import { trackSlotScopes, trackVForSlotScopes } from './transforms/vSlot.ts'

export type TransformPreset = [
    NodeTransform[],
    Record<string, DirectiveTransform>,
]

export function getBaseTransformPreset(
    prefixIdentifiers?: boolean,
): TransformPreset {
    return [
        [
            transformVBindShorthand,
            transformOnce,
            transformIf,
            transformMemo,
            transformFor,
            ...(([])),
            ...((prefixIdentifiers)
                ? [
                    // order is important
                    trackVForSlotScopes,
                    transformExpression,
                ]
                : ([])),
            transformSlotOutlet,
            transformElement,
            trackSlotScopes,
            transformText,
        ],
        {
            on: transformOn,
            bind: transformBind,
            model: transformModel,
        },
    ]
}

// we name it `baseCompile` so that higher order compilers like
// @arrange/vue-compiler-arrange can export `compile` while re-exporting everything else.
export function baseCompile(
    source: string | RootNode,
    options: CompilerOptions = {},
): CodegenResult {
    const onError = options.onError || defaultOnError
    const isModuleMode = options.mode === 'module'
    /* v8 ignore start */

    /* v8 ignore stop */

    const prefixIdentifiers =
        ((options.prefixIdentifiers === true || isModuleMode))
    if (!prefixIdentifiers && options.cacheHandlers) {
        onError(createCompilerError(ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED))
    }

    const resolvedOptions = extend({}, options, {
        prefixIdentifiers,
    })
    const ast = isString(source) ? baseParse(source, resolvedOptions) : source
    const [nodeTransforms, directiveTransforms] =
        getBaseTransformPreset(prefixIdentifiers)

    if ((options.isTS)) {
        const { expressionPlugins } = options
        if (!expressionPlugins || !expressionPlugins.includes('typescript')) {
            options.expressionPlugins = [...(expressionPlugins || []), 'typescript']
        }
    }

    transform(
        ast,
        extend({}, resolvedOptions, {
            nodeTransforms: [
                ...nodeTransforms,
                ...(options.nodeTransforms || []), // user transforms
            ],
            directiveTransforms: extend(
                {},
                directiveTransforms,
                options.directiveTransforms || {}, // user transforms
            ),
        }),
    )

    return generate(ast, resolvedOptions)
}
