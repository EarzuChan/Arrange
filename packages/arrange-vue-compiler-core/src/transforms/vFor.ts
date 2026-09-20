import { PatchFlags } from '@arrange/vue-shared'
import {
    type BlockCodegenNode,
    ConstantTypes,
    type DirectiveNode,
    type ElementNode,
    type ExpressionNode,
    type ForCodegenNode,
    type ForIteratorExpression,
    type ForNode,
    type ForParseResult,
    type ForRenderListExpression,
    NodeTypes,
    type PlainElementNode,
    type RenderSlotCall,
    type SimpleExpressionNode,
    type SlotOutletNode,
    type VNodeCall,
    createBlockStatement,
    createCallExpression,
    createCompoundExpression,
    createFunctionExpression,
    createObjectExpression,
    createObjectProperty,
    createSimpleExpression,
    createVNodeCall,
    getVNodeBlockHelper,
    getVNodeHelper,
} from '../ast.ts'
import { ErrorCodes, createCompilerError } from '../errors.ts'
import {
    FRAGMENT,
    OPEN_BLOCK,
    RENDER_LIST,
} from '../runtimeHelpers.ts'
import {
    type NodeTransform,
    type TransformContext,
    createStructuralDirectiveTransform,
} from '../transform.ts'
import {
    findDir,
    findProp,
    injectProp,
    isSlotOutlet,
    isTemplateNode,
} from '../utils.ts'
import { validateBrowserExpression } from '../validateExpression.ts'
import { processExpression } from './transformExpression.ts'

export const transformFor: NodeTransform = createStructuralDirectiveTransform(
    'for',
    (node, dir, context) => {
        const { helper, removeHelper } = context
        return processFor(node, dir, context, forNode => {
            // create the loop render function expression now, and add the
            // iterator on exit after all children have been traversed
            const renderExp = createCallExpression(helper(RENDER_LIST), [
                forNode.source,
            ]) as ForRenderListExpression
            const isTemplate = isTemplateNode(node)
            const keyProp = findProp(node, `key`, false, true)
            const isDirKey = keyProp && keyProp.type === NodeTypes.DIRECTIVE
            let keyExp =
                keyProp &&
                (keyProp.type === NodeTypes.ATTRIBUTE
                    ? keyProp.value
                        ? createSimpleExpression(keyProp.value.content, true)
                        : undefined
                    : keyProp.exp)

            const keyProperty =
                keyProp && keyExp ? createObjectProperty(`key`, keyExp) : null

            if ((isTemplate)) {
                if (keyProperty && keyProp!.type !== NodeTypes.ATTRIBUTE) {
                    keyProperty.value = processExpression(
                        keyProperty.value as SimpleExpressionNode,
                        context,
                    )
                }
            }

            const isStableFragment =
                forNode.source.type === NodeTypes.SIMPLE_EXPRESSION &&
                forNode.source.constType > ConstantTypes.NOT_CONSTANT
            const fragmentFlag = isStableFragment
                ? PatchFlags.STABLE_FRAGMENT
                : keyProp
                    ? PatchFlags.KEYED_FRAGMENT
                    : PatchFlags.UNKEYED_FRAGMENT

            forNode.codegenNode = createVNodeCall(
                context,
                helper(FRAGMENT),
                undefined,
                renderExp,
                fragmentFlag,
                undefined,
                true /* isBlock */,
                !isStableFragment /* disableTracking */,
                false /* isArrangable */,
                node.loc,
            ) as ForCodegenNode

            return () => {
                // finish the codegen now that all children have been traversed
                let childBlock: BlockCodegenNode
                const { children } = forNode

                // check <template v-for> key placement
                if ((__DEV__ || !false) && isTemplate) {
                    node.children.some(c => {
                        if (c.type === NodeTypes.ELEMENT) {
                            const key = findProp(c, 'key')
                            if (key) {
                                context.onError(
                                    createCompilerError(
                                        ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT,
                                        key.loc,
                                    ),
                                )
                                return true
                            }
                        }
                    })
                }

                const needFragmentWrapper =
                    children.length !== 1 || children[0].type !== NodeTypes.ELEMENT
                const slotOutlet = isSlotOutlet(node)
                    ? node
                    : isTemplate &&
                        node.children.length === 1 &&
                        isSlotOutlet(node.children[0])
                        ? (node.children[0] as SlotOutletNode) // api-extractor somehow fails to infer this
                        : null

                if (slotOutlet) {
                    // <slot v-for="..."> or <template v-for="..."><slot/></template>
                    childBlock = slotOutlet.codegenNode as RenderSlotCall
                    if (isTemplate && keyProperty) {
                        // <template v-for="..." :key="..."><slot/></template>
                        // we need to inject the key to the renderSlot() call.
                        // the props for renderSlot is passed as the 3rd argument.
                        injectProp(childBlock, keyProperty, context)
                    }
                } else if (needFragmentWrapper) {
                    // <template v-for="..."> with text or multi-elements
                    // should generate a fragment block for each loop
                    childBlock = createVNodeCall(
                        context,
                        helper(FRAGMENT),
                        keyProperty ? createObjectExpression([keyProperty]) : undefined,
                        node.children,
                        PatchFlags.STABLE_FRAGMENT,
                        undefined,
                        true,
                        undefined,
                        false /* isArrangable */,
                    )
                } else {
                    // Normal element v-for. Directly use the child's codegenNode
                    // but mark it as a block.
                    childBlock = (children[0] as PlainElementNode)
                        .codegenNode as VNodeCall
                    if (isTemplate && keyProperty) {
                        injectProp(childBlock, keyProperty, context)
                    }
                    if (childBlock.isBlock !== !isStableFragment) {
                        if (childBlock.isBlock) {
                            // switch from block to vnode
                            removeHelper(OPEN_BLOCK)
                            removeHelper(
                                getVNodeBlockHelper(childBlock.isArrangable),
                            )
                        } else {
                            // switch from vnode to block
                            removeHelper(
                                getVNodeHelper(childBlock.isArrangable),
                            )
                        }
                    }
                    childBlock.isBlock = !isStableFragment
                    if (childBlock.isBlock) {
                        helper(OPEN_BLOCK)
                        helper(getVNodeBlockHelper(childBlock.isArrangable))
                    } else {
                        helper(getVNodeHelper(childBlock.isArrangable))
                    }
                }

                    renderExp.arguments.push(
                        createFunctionExpression(
                            createForLoopParams(forNode.parseResult),
                            childBlock,
                            true /* force newline */,
                        ) as ForIteratorExpression,
                    )
            }
        })
    },
)

export function processFor(
    node: ElementNode,
    dir: DirectiveNode,
    context: TransformContext,
    processCodegen?: (forNode: ForNode) => (() => void) | undefined,
): (() => void) | undefined {
    if (!dir.exp) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_FOR_NO_EXPRESSION, dir.loc),
        )
        return
    }

    const parseResult = dir.forParseResult

    if (!parseResult) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, dir.loc),
        )
        return
    }

    finalizeForParseResult(parseResult, context)

    const { addIdentifiers, removeIdentifiers, scopes } = context
    const { source, value, key, index } = parseResult

    const forNode: ForNode = {
        type: NodeTypes.FOR,
        loc: dir.loc,
        source,
        valueAlias: value,
        keyAlias: key,
        objectIndexAlias: index,
        parseResult,
        children: isTemplateNode(node) ? node.children : [node],
    }

    context.replaceNode(forNode)

    // bookkeeping
    scopes.vFor++
    if ((context.prefixIdentifiers)) {
        // scope management
        // inject identifiers to context
        value && addIdentifiers(value)
        key && addIdentifiers(key)
        index && addIdentifiers(index)
    }

    const onExit = processCodegen && processCodegen(forNode)

    return (): void => {
        scopes.vFor--
        if ((context.prefixIdentifiers)) {
            value && removeIdentifiers(value)
            key && removeIdentifiers(key)
            index && removeIdentifiers(index)
        }
        if (onExit) onExit()
    }
}

export function finalizeForParseResult(
    result: ForParseResult,
    context: TransformContext,
): void {
    if (result.finalized) return

    if ((context.prefixIdentifiers)) {
        result.source = processExpression(
            result.source as SimpleExpressionNode,
            context,
        )
        if (result.key) {
            result.key = processExpression(
                result.key as SimpleExpressionNode,
                context,
                true,
            )
        }
        if (result.index) {
            result.index = processExpression(
                result.index as SimpleExpressionNode,
                context,
                true,
            )
        }
        if (result.value) {
            result.value = processExpression(
                result.value as SimpleExpressionNode,
                context,
                true,
            )
        }
    }
    if (__DEV__ && false) {
        validateBrowserExpression(result.source as SimpleExpressionNode, context)
        if (result.key) {
            validateBrowserExpression(
                result.key as SimpleExpressionNode,
                context,
                true,
            )
        }
        if (result.index) {
            validateBrowserExpression(
                result.index as SimpleExpressionNode,
                context,
                true,
            )
        }
        if (result.value) {
            validateBrowserExpression(
                result.value as SimpleExpressionNode,
                context,
                true,
            )
        }
    }
    result.finalized = true
}

export function createForLoopParams(
    { value, key, index }: ForParseResult,
): ExpressionNode[] {
    return createParamsList([value, key, index])
}

function createParamsList(
    args: (ExpressionNode | undefined)[],
): ExpressionNode[] {
    let i = args.length
    while (i--) {
        if (args[i]) break
    }
    return args
        .slice(0, i + 1)
        .map((arg, i) => arg || createSimpleExpression(`_`.repeat(i + 1), false))
}
