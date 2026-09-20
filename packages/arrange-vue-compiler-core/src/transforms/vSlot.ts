import { SlotFlags, slotFlagsText } from '@arrange/vue-shared'
import {
    type CallExpression,
    type ConditionalExpression,
    type DirectiveNode,
    type ElementNode,
    ElementTypes,
    type ExpressionNode,
    type FunctionExpression,
    NodeTypes,
    type ObjectExpression,
    type Property,
    type SlotsExpression,
    type SourceLocation,
    type TemplateChildNode,
    createArrayExpression,
    createCallExpression,
    createConditionalExpression,
    createFunctionExpression,
    createObjectExpression,
    createObjectProperty,
    createSimpleExpression,
} from '../ast.ts'
import { ErrorCodes, createCompilerError } from '../errors.ts'
import { CREATE_SLOTS, RENDER_LIST, WITH_CTX } from '../runtimeHelpers.ts'
import type { NodeTransform, TransformContext } from '../transform.ts'
import {
    assert,
    findDir,
    hasScopeRef,
    isCommentOrWhitespace,
    isStaticExp,
    isTemplateNode,
    isVSlot,
    isWhitespaceText,
} from '../utils.ts'
import { createForLoopParams, finalizeForParseResult } from './vFor.ts'

const defaultFallback = createSimpleExpression(`undefined`, false)

// 记录内容声明的嵌套深度，不引入槽位参数作用域
export const trackSlotScopes: NodeTransform = (node, context) => {
    if (node.type !== NodeTypes.ELEMENT || !findDir(node, 'slot', true)) return
    context.scopes.vSlot++
    return () => { context.scopes.vSlot-- }
}

// A NodeTransform that tracks scope identifiers for scoped slots with v-for.

export const trackVForSlotScopes: NodeTransform = (node, context) => {
    let vFor
    if (
        isTemplateNode(node) &&
        node.props.some(isVSlot) &&
        (vFor = findDir(node, 'for'))
    ) {
        const result = vFor.forParseResult
        if (result) {
            finalizeForParseResult(result, context)
            const { value, key, index } = result
            const { addIdentifiers, removeIdentifiers } = context
            value && addIdentifiers(value)
            key && addIdentifiers(key)
            index && addIdentifiers(index)

            return () => {
                value && removeIdentifiers(value)
                key && removeIdentifiers(key)
                index && removeIdentifiers(index)
            }
        }
    }
}

export type SlotFnBuilder = (
    vFor: DirectiveNode | undefined,
    slotChildren: TemplateChildNode[],
    loc: SourceLocation,
) => FunctionExpression

const buildClientSlotFn: SlotFnBuilder = (_vForExp, children, loc) =>
    createFunctionExpression(
        undefined,
        children,
        false /* newline */,
        true /* isSlot */,
        children.length ? children[0].loc : loc,
    )

// Instead of being a DirectiveTransform, v-slot processing is called during
// transformElement to build the slots object for a arrangable.
export function buildSlots(
    node: ElementNode,
    context: TransformContext,
    buildSlotFn: SlotFnBuilder = buildClientSlotFn,
): {
    slots: SlotsExpression
    hasDynamicSlots: boolean
} {
    context.helper(WITH_CTX)

    const { children, loc } = node
    const slotsProperties: Property[] = []
    const dynamicSlots: (ConditionalExpression | CallExpression)[] = []

    // If the slot is inside a v-for or another v-slot, force it to be dynamic
    // since it likely uses a scope variable.
    let hasDynamicSlots = context.scopes.vSlot > 0 || context.scopes.vFor > 0
    // with `prefixIdentifiers: true`, this can be further optimized to make
    // it dynamic when
    // 1. the slot arg or exp uses the scope variables.
    // 2. the slot children use the scope variables.
    if ((context.prefixIdentifiers)) {
        hasDynamicSlots =
            context.scopes.vSlot > 0 || context.scopes.vFor > 0 || node.props.some(
                prop =>
                    isVSlot(prop) &&
                    (hasScopeRef(prop.arg, context.identifiers) ||
                        hasScopeRef(prop.exp, context.identifiers)),
            ) || children.some(child => hasScopeRef(child, context.identifiers))
    }

    let hasTemplateSlots = false
    let hasNamedDefaultSlot = false
    const implicitDefaultChildren: TemplateChildNode[] = []
    const seenSlotNames = new Set<string>()
    let conditionalBranchIndex = 0

    for (let i = 0; i < children.length; i++) {
        const slotElement = children[i]
        let slotDir

        if (
            !isTemplateNode(slotElement) ||
            !(slotDir = findDir(slotElement, 'slot', true))
        ) {
            // not a <template v-slot>, skip.
            if (slotElement.type !== NodeTypes.COMMENT) {
                implicitDefaultChildren.push(slotElement)
            }
            continue
        }

        hasTemplateSlots = true
        const { children: slotChildren, loc: slotLoc } = slotElement
        const {
            arg: slotName = createSimpleExpression(`default`, true),
            loc: dirLoc,
        } = slotDir

        // check if name is dynamic.
        let staticSlotName: string | undefined
        if (isStaticExp(slotName)) {
            staticSlotName = slotName ? slotName.content : `default`
        } else {
            hasDynamicSlots = true
        }

        const vFor = findDir(slotElement, 'for')
        const slotFunction = buildSlotFn(vFor, slotChildren, slotLoc)

        // check if this slot is conditional (v-if/v-for)
        let vIf: DirectiveNode | undefined
        let vElse: DirectiveNode | undefined
        if ((vIf = findDir(slotElement, 'if'))) {
            hasDynamicSlots = true
            dynamicSlots.push(
                createConditionalExpression(
                    vIf.exp!,
                    buildDynamicSlot(slotName, slotFunction, conditionalBranchIndex++),
                    defaultFallback,
                ),
            )
        } else if (
            (vElse = findDir(slotElement, /^else(?:-if)?$/, true /* allowEmpty */))
        ) {
            // find adjacent v-if
            let j = i
            let prev
            while (j--) {
                prev = children[j]
                if (!isCommentOrWhitespace(prev)) {
                    break
                }
            }
            if (prev && isTemplateNode(prev) && findDir(prev, /^(?:else-)?if$/)) {
                __TEST__ && assert(dynamicSlots.length > 0)
                // attach this slot to previous conditional
                let conditional = dynamicSlots[
                    dynamicSlots.length - 1
                ] as ConditionalExpression
                while (
                    conditional.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
                ) {
                    conditional = conditional.alternate
                }
                conditional.alternate = vElse.exp
                    ? createConditionalExpression(
                        vElse.exp,
                        buildDynamicSlot(
                            slotName,
                            slotFunction,
                            conditionalBranchIndex++,
                        ),
                        defaultFallback,
                    )
                    : buildDynamicSlot(slotName, slotFunction, conditionalBranchIndex++)
            } else {
                context.onError(
                    createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, vElse.loc),
                )
            }
        } else if (vFor) {
            hasDynamicSlots = true
            const parseResult = vFor.forParseResult
            if (parseResult) {
                finalizeForParseResult(parseResult, context)
                // Render the dynamic slots as an array and add it to the createSlot()
                // args. The runtime knows how to handle it appropriately.
                dynamicSlots.push(
                    createCallExpression(context.helper(RENDER_LIST), [
                        parseResult.source,
                        createFunctionExpression(
                            createForLoopParams(parseResult),
                            buildDynamicSlot(slotName, slotFunction),
                            true /* force newline */,
                        ),
                    ]),
                )
            } else {
                context.onError(
                    createCompilerError(
                        ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
                        vFor.loc,
                    ),
                )
            }
        } else {
            // check duplicate static names
            if (staticSlotName) {
                if (seenSlotNames.has(staticSlotName)) {
                    context.onError(
                        createCompilerError(
                            ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES,
                            dirLoc,
                        ),
                    )
                    continue
                }
                seenSlotNames.add(staticSlotName)
                if (staticSlotName === 'default') {
                    hasNamedDefaultSlot = true
                }
            }
            slotsProperties.push(createObjectProperty(slotName, slotFunction))
        }
    }

    const buildDefaultSlotProperty = (
            children: TemplateChildNode[],
    ) => {
        const fn = buildSlotFn(undefined, children, loc)

        return createObjectProperty(`default`, fn)
    }

    if (!hasTemplateSlots) {
        // implicit default slot (on arrangable)
        slotsProperties.push(buildDefaultSlotProperty(children))
    } else if (
        implicitDefaultChildren.length &&
        // #3766
        // with whitespace: 'preserve', whitespaces between slots will end up in
        // implicitDefaultChildren. Ignore if all implicit children are whitespaces.
        !implicitDefaultChildren.every(isWhitespaceText)
    ) {
        // implicit default slot (mixed with named slots)
        if (hasNamedDefaultSlot) {
            context.onError(
                createCompilerError(
                    ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
                    implicitDefaultChildren[0].loc,
                ),
            )
        } else {
            slotsProperties.push(
                buildDefaultSlotProperty(implicitDefaultChildren),
            )
        }
    }

    const slotFlag = hasDynamicSlots
        ? SlotFlags.DYNAMIC
        : hasForwardedSlots(node.children)
            ? SlotFlags.FORWARDED
            : SlotFlags.STABLE
    let slots = createObjectExpression(
        slotsProperties.concat(
            createObjectProperty(
                `_`,
                // 2 = compiled but dynamic = can skip normalization, but must run diff
                // 1 = compiled and static = can skip normalization AND diff as optimized
                createSimpleExpression(
                    slotFlag + (__DEV__ ? ` /* ${slotFlagsText[slotFlag]} */` : ``),
                    false,
                ),
            ),
        ),
        loc,
    ) as SlotsExpression
    if (dynamicSlots.length) {
        slots = createCallExpression(context.helper(CREATE_SLOTS), [
            slots,
            createArrayExpression(dynamicSlots),
        ]) as SlotsExpression
    }

    return {
        slots,
        hasDynamicSlots,
    }
}

function buildDynamicSlot(
    name: ExpressionNode,
    fn: FunctionExpression,
    index?: number,
): ObjectExpression {
    const props = [
        createObjectProperty(`name`, name),
        createObjectProperty(`fn`, fn),
    ]
    if (index != null) {
        props.push(
            createObjectProperty(`key`, createSimpleExpression(String(index), true)),
        )
    }
    return createObjectExpression(props)
}

function hasForwardedSlots(children: TemplateChildNode[]): boolean {
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        switch (child.type) {
            case NodeTypes.ELEMENT:
                if (
                    child.tagType === ElementTypes.SLOT ||
                    hasForwardedSlots(child.children)
                ) {
                    return true
                }
                break
            case NodeTypes.IF:
                if (hasForwardedSlots(child.branches)) return true
                break
            case NodeTypes.IF_BRANCH:
            case NodeTypes.FOR:
                if (hasForwardedSlots(child.children)) return true
                break
            default:
                break
        }
    }
    return false
}
