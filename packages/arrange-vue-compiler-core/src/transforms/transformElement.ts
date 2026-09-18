import {
    PatchFlags,
    camelize,
    capitalize,
    isBuiltInDirective,
    isObject,
    isOn,
    isReservedProp,
    isSymbol,
} from '@arrange/vue-shared'
import {
    type ArrayExpression,
    type CallExpression,
    type ComponentNode,
    ConstantTypes,
    type DirectiveArguments,
    type DirectiveNode,
    type ElementNode,
    ElementTypes,
    type ExpressionNode,
    type JSChildNode,
    NodeTypes,
    type ObjectExpression,
    type Property,
    type TemplateTextChildNode,
    type VNodeCall,
    createArrayExpression,
    createCallExpression,
    createFunctionExpression,
    createObjectExpression,
    createObjectProperty,
    createSimpleExpression,
    createVNodeCall,
} from '../ast.ts'
import { ErrorCodes, createCompilerError } from '../errors.ts'
import { BindingTypes } from '../options.ts'
import {
    ARRANGE_PROPS,
    ARRANGE_VALUE,
    ARRANGE_RESOURCE,
    KEEP_ALIVE,
    MERGE_PROPS,
    RESOLVE_COMPONENT,
    RESOLVE_DIRECTIVE,
    RESOLVE_DYNAMIC_COMPONENT,
    SUSPENSE,
    TELEPORT,
    TO_HANDLERS,
    UNREF
} from '../runtimeHelpers.ts'
import type { NodeTransform, TransformContext } from '../transform.ts'
import {
    findProp,
    isCoreComponent,
    isStaticArgOf,
    isStaticExp,
    toValidAssetId,
} from '../utils.ts'
import { splitArrangeModifier } from './arrangeModifier.ts'
import { getConstantType } from './cacheStatic.ts'
import { processExpression } from './transformExpression.ts'
import { buildSlots } from './vSlot.ts'

// some directive transforms (e.g. v-model) may return a symbol for runtime
// import, which should be used instead of a resolveDirective call.
const directiveImportMap = new WeakMap<DirectiveNode, symbol>()

// generate a JavaScript AST for this element's codegen
export const transformElement: NodeTransform = (node, context) => {
    // perform the work on exit, after all child expressions have been
    // processed and merged.
    return function postTransformElement() {
        node = context.currentNode!

        if (
            !(
                node.type === NodeTypes.ELEMENT &&
                (node.tagType === ElementTypes.ELEMENT ||
                    node.tagType === ElementTypes.COMPONENT)
            )
        ) {
            return
        }

        const { tag, props } = node
        const isComponent = node.tagType === ElementTypes.COMPONENT

        // The goal of the transform is to create a codegenNode implementing the
        // VNodeCall interface.
        let vnodeTag = isComponent
            ? resolveComponentType(node as ComponentNode, context)
            : `"${tag}"`

        const isDynamicComponent =
            isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT

        let vnodeProps: VNodeCall['props']
        let vnodeChildren: VNodeCall['children']
        let patchFlag: VNodeCall['patchFlag'] | 0 = 0
        let vnodeDynamicProps: VNodeCall['dynamicProps']
        let dynamicPropNames: string[] | undefined
        let vnodeDirectives: VNodeCall['directives']

        let shouldUseBlock =
            // dynamic component may resolve to plain elements
            isDynamicComponent ||
            vnodeTag === TELEPORT ||
            vnodeTag === SUSPENSE ||
            (!isComponent &&
                // <svg> and <foreignObject> must be forced into blocks so that block
                // updates inside get proper isSVG flag at runtime. (#639, #643)
                // This is technically web-specific, but splitting the logic out of core
                // leads to too much unnecessary complexity.
                (tag === 'svg' || tag === 'foreignObject' || tag === 'math'))

        // props
        if (props.length > 0) {
            const propsBuildResult = buildProps(
                node,
                context,
                undefined,
                isComponent,
                isDynamicComponent,
            )
            vnodeProps = propsBuildResult.props
            patchFlag = propsBuildResult.patchFlag
            dynamicPropNames = propsBuildResult.dynamicPropNames
            const directives = propsBuildResult.directives
            vnodeDirectives =
                directives && directives.length
                    ? (createArrayExpression(
                        directives.map(dir => buildDirectiveArgs(dir, context)),
                    ) as DirectiveArguments)
                    : undefined

            if (propsBuildResult.shouldUseBlock) {
                shouldUseBlock = true
            }
        }

        // children
        if (node.children.length > 0) {
            if (vnodeTag === KEEP_ALIVE) {
                // Although a built-in component, we compile KeepAlive with raw children
                // instead of slot functions so that it can be used inside Transition
                // or other Transition-wrapping HOCs.
                // To ensure correct updates with block optimizations, we need to:
                // 1. Force keep-alive into a block. This avoids its children being
                //    collected by a parent block.
                shouldUseBlock = true
                // 2. Force keep-alive to always be updated, since it uses raw children.
                patchFlag |= PatchFlags.DYNAMIC_SLOTS
                if (__DEV__ && node.children.length > 1) {
                    context.onError(
                        createCompilerError(ErrorCodes.X_KEEP_ALIVE_INVALID_CHILDREN, {
                            start: node.children[0].loc.start,
                            end: node.children[node.children.length - 1].loc.end,
                            source: '',
                        }),
                    )
                }
            }

            const shouldBuildAsSlots =
                isComponent &&
                // Teleport is not a real component and has dedicated runtime handling
                vnodeTag !== TELEPORT &&
                // explained above.
                vnodeTag !== KEEP_ALIVE

            if (shouldBuildAsSlots) {
                const { slots, hasDynamicSlots } = buildSlots(node, context)
                vnodeChildren = slots
                if (hasDynamicSlots) {
                    patchFlag |= PatchFlags.DYNAMIC_SLOTS
                }
            } else if (node.children.length === 1 && vnodeTag !== TELEPORT) {
                const child = node.children[0]
                const type = child.type
                // check for dynamic text children
                const hasDynamicTextChild =
                    type === NodeTypes.INTERPOLATION ||
                    type === NodeTypes.COMPOUND_EXPRESSION
                if (
                    hasDynamicTextChild &&
                    getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
                ) {
                    patchFlag |= PatchFlags.TEXT
                }
                // pass directly if the only child is a text node
                // (plain / interpolation / expression)
                if (hasDynamicTextChild || type === NodeTypes.TEXT) {
                    vnodeChildren = (hasDynamicTextChild)
                        ? createCallExpression(context.helper(ARRANGE_VALUE), [createFunctionExpression(undefined, child, true)])
                        : child as TemplateTextChildNode
                } else {
                    vnodeChildren = node.children
                }
            } else {
                vnodeChildren = node.children
            }
        }

        // patchFlag & dynamicPropNames
        if (dynamicPropNames && dynamicPropNames.length) {
            vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames)
        }

        node.codegenNode = createVNodeCall(
            context,
            vnodeTag,
            vnodeProps,
            vnodeChildren,
            patchFlag === 0 ? undefined : patchFlag,
            vnodeDynamicProps,
            vnodeDirectives,
            !!shouldUseBlock,
            false /* disableTracking */,
            isComponent,
            node.loc,
        )
    }
}

export function resolveComponentType(
    node: ComponentNode,
    context: TransformContext,
): string | symbol | CallExpression {
    let { tag } = node

    // 1. dynamic component
    const isExplicitDynamic = isComponentTag(tag)
    const isProp = findProp(node, 'is', false, true /* allow empty */)
    if (isProp) {
        if (
            (isExplicitDynamic)
        ) {
            let exp: ExpressionNode | undefined
            if (isProp.type === NodeTypes.ATTRIBUTE) {
                exp = isProp.value && createSimpleExpression(isProp.value.content, true)
            } else {
                exp = isProp.exp
                if (!exp) {
                    // #10469 handle :is shorthand
                    exp = createSimpleExpression(`is`, false, isProp.arg!.loc)
                    {
                        exp = isProp.exp = processExpression(exp, context)
                    }
                }
            }
            if (exp) {
                return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
                    exp,
                ])
            }
        } else if (
            isProp.type === NodeTypes.ATTRIBUTE &&
            isProp.value!.content.startsWith('vue:')
        ) {
            // <button is="vue:xxx">
            // if not <component>, only is value that starts with "vue:" will be
            // treated as component by the parse phase and reach here, unless it's
            // compat mode where all is values are considered components
            tag = isProp.value!.content.slice(4)
        }
    }

    // 2. built-in components (Teleport, Transition, KeepAlive, Suspense...)
    const builtIn = isCoreComponent(tag) || context.isBuiltInComponent(tag)
    if (builtIn) {

        // so we don't need to import their runtime equivalents
        context.helper(builtIn)
        return builtIn
    }

    // 3. user component (from setup bindings)

    // binding analysis.
    {
        const fromSetup = resolveSetupReference(tag, context)
        if (fromSetup) {
            return fromSetup
        }
        const dotIndex = tag.indexOf('.')
        if (dotIndex > 0) {
            const ns = resolveSetupReference(tag.slice(0, dotIndex), context)
            if (ns) {
                return ns + tag.slice(dotIndex)
            }
        }
    }

    // 4. Self referencing component (inferred from filename)
    if (
        (context.selfName) &&
        capitalize(camelize(tag)) === context.selfName
    ) {
        context.helper(RESOLVE_COMPONENT)
        // codegen.ts has special check for __self postfix when generating
        // component imports, which will pass additional `maybeSelfReference` flag
        // to `resolveComponent`.
        context.components.add(tag + `__self`)
        return toValidAssetId(tag, `component`)
    }

    // 5. user component (resolve)
    context.helper(RESOLVE_COMPONENT)
    context.components.add(tag)
    return toValidAssetId(tag, `component`)
}

function resolveSetupReference(name: string, context: TransformContext) {
    const bindings = context.bindingMetadata
    if (!bindings || bindings.__isScriptSetup === false) {
        return
    }

    const camelName = camelize(name)
    const PascalName = capitalize(camelName)
    const checkType = (type: BindingTypes) => {
        if (bindings[name] === type) {
            return name
        }
        if (bindings[camelName] === type) {
            return camelName
        }
        if (bindings[PascalName] === type) {
            return PascalName
        }
    }

    const fromConst =
        checkType(BindingTypes.SETUP_CONST) ||
        checkType(BindingTypes.SETUP_REACTIVE_CONST) ||
        checkType(BindingTypes.LITERAL_CONST)
    if (fromConst) {
        return context.inline
            ? // in inline mode, const setup bindings (e.g. imports) can be used as-is
            fromConst
            : `$setup[${JSON.stringify(fromConst)}]`
    }

    const fromMaybeRef =
        checkType(BindingTypes.SETUP_LET) ||
        checkType(BindingTypes.SETUP_REF) ||
        checkType(BindingTypes.SETUP_MAYBE_REF)
    if (fromMaybeRef) {
        return context.inline
            ? // setup scope bindings that may be refs need to be unrefed
            `${context.helperString(UNREF)}(${fromMaybeRef})`
            : `$setup[${JSON.stringify(fromMaybeRef)}]`
    }

    const fromProps = checkType(BindingTypes.PROPS)
    if (fromProps) {
        return `${context.helperString(UNREF)}(${context.inline ? '__props' : '$props'
            }[${JSON.stringify(fromProps)}])`
    }
}

export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode

export function buildProps(
    node: ElementNode,
    context: TransformContext,
    props: ElementNode['props'] | undefined = node.props,
    isComponent: boolean,
    isDynamicComponent: boolean,
): {
    props: PropsExpression | undefined
    directives: DirectiveNode[]
    patchFlag: number
    dynamicPropNames: string[]
    shouldUseBlock: boolean
} {
    const { tag, loc: elementLoc, children } = node
    let properties: ObjectExpression['properties'] = []
    const mergeArgs: PropsExpression[] = []
    const runtimeDirectives: DirectiveNode[] = []
    const hasChildren = children.length > 0
    let shouldUseBlock = false

    // patchFlag analysis
    let patchFlag = 0
    let hasRef = false
    let hasDynamicKeys = false
    let hasVnodeHook = false
    const dynamicPropNames: string[] = []

    const pushMergeArg = (arg?: PropsExpression) => {
        if (properties.length) {
            mergeArgs.push(
                createObjectExpression(dedupeProperties(properties), elementLoc),
            )
            properties = []
        }
        if (arg) mergeArgs.push(arg)
    }

    // mark template ref on v-for
    const pushRefVForMarker = () => {
        if (context.scopes.vFor > 0) {
            properties.push(
                createObjectProperty(
                    createSimpleExpression('ref_for', true),
                    createSimpleExpression('true'),
                ),
            )
        }
    }

    const analyzePatchFlag = ({ key, value }: Property) => {
        if (isStaticExp(key)) {
            const name = key.content
            const isEventHandler = isOn(name)

            if (isEventHandler && isReservedProp(name)) {
                hasVnodeHook = true
            }

            if (isEventHandler && value.type === NodeTypes.JS_CALL_EXPRESSION) {
                // handler wrapped with internal helper e.g. withModifiers(fn)
                // extract the actual expression
                value = value.arguments[0] as JSChildNode
            }

            if (
                value.type === NodeTypes.JS_CACHE_EXPRESSION ||
                ((value.type === NodeTypes.SIMPLE_EXPRESSION ||
                    value.type === NodeTypes.COMPOUND_EXPRESSION) &&
                    getConstantType(value, context) > 0)
            ) {
                // skip if the prop is a cached handler or has constant value
                return
            }

            if (name === 'ref') {
                hasRef = true
            } else if (name !== 'key' && !dynamicPropNames.includes(name)) {
                dynamicPropNames.push(name)
            }

        } else {
            hasDynamicKeys = true
        }
    }

    for (let i = 0; i < props.length; i++) {
        // static attribute
        const prop = props[i]
        if (prop.type === NodeTypes.ATTRIBUTE) {
            const { loc, name, nameLoc, value } = prop
            let isStatic = true
            if (name === 'ref') {
                hasRef = true
                pushRefVForMarker()
                // in inline mode there is no setupState object, so we can't use string
                // keys to set the ref. Instead, we need to transform it to pass the
                // actual ref instead.
                if ((value) && context.inline) {
                    const binding = context.bindingMetadata[value.content]
                    if (
                        binding === BindingTypes.SETUP_LET ||
                        binding === BindingTypes.SETUP_REF ||
                        binding === BindingTypes.SETUP_MAYBE_REF
                    ) {
                        isStatic = false
                        properties.push(
                            createObjectProperty(
                                createSimpleExpression('ref_key', true),
                                createSimpleExpression(value.content, true, value.loc),
                            ),
                        )
                    }
                }
            }
            // skip is on <component>, or is="vue:xxx"
            if (
                name === 'is' &&
                ((isComponentTag(tag) ||
                    (value && value.content.startsWith('vue:'))))
            ) {
                continue
            }
            properties.push(
                createObjectProperty(
                    createSimpleExpression(name, true, nameLoc),
                    createSimpleExpression(
                        value ? value.content : '',
                        isStatic,
                        value ? value.loc : loc,
                    ),
                ),
            )
        } else {
            // directives
            const { name, arg, exp, loc, modifiers } = prop
            const isVBind = name === 'bind'
            const isVOn = name === 'on'

            // skip v-slot - it is handled by its dedicated transform.
            if (name === 'slot') {
                if (!isComponent) {
                    context.onError(
                        createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, loc),
                    )
                }
                continue
            }
            // skip v-once/v-memo - they are handled by dedicated transforms.
            if (name === 'once' || name === 'memo') {
                continue
            }
            // skip v-is and :is on <component>
            if (
                name === 'is' ||
                (isVBind &&
                    isStaticArgOf(arg, 'is') &&
                    ((isComponentTag(tag))))
            ) {
                continue
            }

            if (
                // #938: elements with dynamic keys should be forced into blocks
                (isVBind && isStaticArgOf(arg, 'key')) ||
                // inline before-update hooks need to force block so that it is invoked
                // before children
                (isVOn && hasChildren && isStaticArgOf(arg, 'vue:before-update'))
            ) {
                shouldUseBlock = true
            }

            if (isVBind && isStaticArgOf(arg, 'ref')) {
                pushRefVForMarker()
            }

            // special case for v-bind and v-on with no argument
            if (!arg && (isVBind || isVOn)) {
                hasDynamicKeys = true
                if (exp) {
                    if (isVBind) {

                        // #10696 in case a v-bind object contains ref
                        pushRefVForMarker()
                        pushMergeArg()
                        mergeArgs.push(exp)
                    } else {
                        // v-on="obj" -> toHandlers(obj)
                        pushMergeArg({
                            type: NodeTypes.JS_CALL_EXPRESSION,
                            loc,
                            callee: context.helper(TO_HANDLERS),
                            arguments: [exp],
                        })
                    }
                } else {
                    context.onError(
                        createCompilerError(
                            isVBind
                                ? ErrorCodes.X_V_BIND_NO_EXPRESSION
                                : ErrorCodes.X_V_ON_NO_EXPRESSION,
                            loc,
                        ),
                    )
                }
                continue
            }

            const directiveTransform = context.directiveTransforms[name]
            if (directiveTransform) {
                // has built-in directive transform.
                const { props, needRuntime } = directiveTransform(prop, node, context)
                props.forEach(analyzePatchFlag)
                if (isVOn && arg && !isStaticExp(arg)) {
                    pushMergeArg(createObjectExpression(props, elementLoc))
                } else {
                    properties.push(...props)
                }
                if (needRuntime) {
                    runtimeDirectives.push(prop)
                    if (isSymbol(needRuntime)) {
                        directiveImportMap.set(prop, needRuntime)
                    }
                }
            } else if (!isBuiltInDirective(name)) {
                // no built-in transform, this is a user custom directive.
                runtimeDirectives.push(prop)
                // custom dirs may use beforeUpdate so they need to force blocks
                // to ensure before-update gets called before children update
                if (hasChildren) {
                    shouldUseBlock = true
                }
            }
        }
    }

    let propsExpression: PropsExpression | undefined = undefined

    // has v-bind="object" or v-on="object", wrap with mergeProps
    if (mergeArgs.length) {
        // close up any not-yet-merged props
        pushMergeArg()
        if (mergeArgs.length > 1) {
            propsExpression = createCallExpression(
                context.helper(MERGE_PROPS),
                mergeArgs,
                elementLoc,
            )
        } else {
            // single v-bind with nothing else - no need for a mergeProps call
            propsExpression = mergeArgs[0]
        }
    } else if (properties.length) {
        propsExpression = createObjectExpression(
            dedupeProperties(properties),
            elementLoc,
        )
    }

    // patchFlag analysis
    if (hasDynamicKeys) {
        patchFlag |= PatchFlags.FULL_PROPS
    } else {
        if (dynamicPropNames.length) {
            patchFlag |= PatchFlags.PROPS
        }
    }
    if (
        !shouldUseBlock &&
        patchFlag === 0 &&
        (hasRef || hasVnodeHook || runtimeDirectives.length > 0)
    ) {
        patchFlag |= PatchFlags.NEED_PATCH
    }

    if ((propsExpression) && hasDynamicKeys) {
        propsExpression = createCallExpression(context.helper(ARRANGE_PROPS), [createFunctionExpression(undefined, propsExpression, true)])
    }

    if ((propsExpression?.type === NodeTypes.JS_OBJECT_EXPRESSION)) {
        for (const property of propsExpression.properties) {
            if (property.key.type !== NodeTypes.SIMPLE_EXPRESSION || !property.key.isStatic) continue
            const name = property.key.content
            if (isReservedProp(name)) continue
            if (dynamicPropNames.includes(name) || isOn(name) || (name === 'source' && (node.tag === 'Image' || node.tag === 'Icon'))) {
                const split = name === 'modifier' ? splitArrangeModifier(property.value, context) : undefined
                const position = property.key.loc.start
                const location = createSimpleExpression(JSON.stringify(`${context.filename}:${position.line}:${position.column} (${name})`), false)
                if (name === 'source' && (node.tag === 'Image' || node.tag === 'Icon')) property.value = createCallExpression(context.helper(ARRANGE_RESOURCE), [property.value, location])
                if (split?.type === NodeTypes.JS_CALL_EXPRESSION) split.arguments.push(location)
                property.value = split ?? createCallExpression(context.helper(ARRANGE_VALUE), [
                    createFunctionExpression(undefined, property.value, true),
                    location,
                ])
            }
        }
    }

    return {
        props: propsExpression,
        directives: runtimeDirectives,
        patchFlag,
        dynamicPropNames,
        shouldUseBlock,
    }
}

// 相同事件输入合并处理器，普通输入保持声明值
function dedupeProperties(properties: Property[]): Property[] {
    const knownProps: Map<string, Property> = new Map()
    const deduped: Property[] = []
    for (let i = 0; i < properties.length; i++) {
        const prop = properties[i]
        // dynamic keys are always allowed
        if (prop.key.type === NodeTypes.COMPOUND_EXPRESSION || !prop.key.isStatic) {
            deduped.push(prop)
            continue
        }
        const name = prop.key.content
        const existing = knownProps.get(name)
        if (existing) {
            if (isOn(name)) {
                mergeAsArray(existing, prop)
            }
            // unexpected duplicate, should have emitted error during parse
        } else {
            knownProps.set(name, prop)
            deduped.push(prop)
        }
    }
    return deduped
}

function mergeAsArray(existing: Property, incoming: Property) {
    if (existing.value.type === NodeTypes.JS_ARRAY_EXPRESSION) {
        existing.value.elements.push(incoming.value)
    } else {
        existing.value = createArrayExpression(
            [existing.value, incoming.value],
            existing.loc,
        )
    }
}

export function buildDirectiveArgs(
    dir: DirectiveNode,
    context: TransformContext,
): ArrayExpression {
    const dirArgs: ArrayExpression['elements'] = []
    const runtime = directiveImportMap.get(dir)
    if (runtime) {
        // built-in directive with runtime
        dirArgs.push(context.helperString(runtime))
    } else {
        // user directive.
        // see if we have directives exposed via <script setup>
        const fromSetup =
            (resolveSetupReference('v-' + dir.name, context))
        if (fromSetup) {
            dirArgs.push(fromSetup)
        } else {
            // inject statement for resolving directive
            context.helper(RESOLVE_DIRECTIVE)
            context.directives.add(dir.name)
            dirArgs.push(toValidAssetId(dir.name, `directive`))
        }
    }
    const { loc } = dir
    if (dir.exp) dirArgs.push(dir.exp)
    if (dir.arg) {
        if (!dir.exp) {
            dirArgs.push(`void 0`)
        }
        dirArgs.push(dir.arg)
    }
    if (Object.keys(dir.modifiers).length) {
        if (!dir.arg) {
            if (!dir.exp) {
                dirArgs.push(`void 0`)
            }
            dirArgs.push(`void 0`)
        }
        const trueExpression = createSimpleExpression(`true`, false, loc)
        dirArgs.push(
            createObjectExpression(
                dir.modifiers.map(modifier =>
                    createObjectProperty(modifier, trueExpression),
                ),
                loc,
            ),
        )
    }
    return createArrayExpression(dirArgs, dir.loc)
}

function stringifyDynamicPropNames(props: string[]): string {
    let propsNamesString = `[`
    for (let i = 0, l = props.length; i < l; i++) {
        propsNamesString += JSON.stringify(props[i])
        if (i < l - 1) propsNamesString += ', '
    }
    return propsNamesString + `]`
}

function isComponentTag(tag: string) {
    return tag === 'component' || tag === 'Component'
}
