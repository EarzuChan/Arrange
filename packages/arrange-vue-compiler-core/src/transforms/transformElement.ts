import { PatchFlags, camelize } from '@arrange/vue-shared'
import { type CallExpression, type ArrangableNode, ConstantTypes, type ElementNode, ElementTypes, type ExpressionNode, NodeTypes, type ObjectExpression, type Property, type VNodeCall, createCallExpression, createFunctionExpression, createObjectExpression, createObjectProperty, createSimpleExpression, createVNodeCall } from '../ast.ts'
import { BindingTypes } from '../options.ts'
import { ARRANGE_PARAMETERS, ARRANGE_PROPS, ARRANGE_VALUE, MERGE_PROPS, RESOLVE_ARRANGABLE, UNREF } from '../runtimeHelpers.ts'
import { type CacheExpression, createArrayExpression } from '../ast.ts'
import type { NodeTransform, TransformContext } from '../transform.ts'
import { isStaticExp, toValidAssetId } from '../utils.ts'
import { splitArrangeModifier } from './arrangeModifier.ts'
import { getConstantType } from './cacheStatic.ts'
import { buildSlots } from './vSlot.ts'
import { transformBind } from './vBind.ts'

export const transformElement: NodeTransform = (node, context) => () => {
    node = context.currentNode!
    if (node.type !== NodeTypes.ELEMENT || node.tagType !== ElementTypes.ELEMENT && node.tagType !== ElementTypes.ARRANGABLE) return
    const isArrangable = node.tagType === ElementTypes.ARRANGABLE
    const tag = isArrangable ? resolveArrangableType(node as ArrangableNode, context) : JSON.stringify(node.tag)
    const parameters = buildProps(node, context)
    if (context.arrangeTypecheck) parameters.props = createCallExpression('__arrangeCheck', [tag, parameters.props ?? createObjectExpression([]), String(node.loc.start.line), String(node.loc.start.column)])
    let children: VNodeCall['children']
    let flags = parameters.patchFlag
    if (node.children.length) {
        if (isArrangable) {
            const result = buildSlots(node, context)
            children = result.slots
            if (context.arrangeTypecheck) children = createCallExpression('__arrangeCheckSlots', [tag, result.slots, String(node.loc.start.line), String(node.loc.start.column)])
            else if (context.inline && !result.hasDynamicSlots && context.scopes.vFor === 0 && context.scopes.vSlot === 0) children = context.cache(result.slots)
            if (result.hasDynamicSlots) flags |= PatchFlags.DYNAMIC_SLOTS
        } else children = node.children
    }
    let props: VNodeCall['props'] = parameters.props
    const binding = context.bindingMetadata[node.tag]
    const fixedDefinition = !binding || binding === BindingTypes.SETUP_CONST || binding === BindingTypes.LITERAL_CONST
    if (!context.arrangeTypecheck && context.inline && isArrangable && fixedDefinition && (!props || props.type === NodeTypes.JS_OBJECT_EXPRESSION)) {
        const properties = props?.properties ?? []
        const names = context.hoist(createArrayExpression(properties.map(property => property.key)))
        const source = JSON.stringify(`${context.filename}:${node.loc.start.line}:${node.loc.start.column} (<${node.tag}>)`)
        props = createCallExpression(context.helper(ARRANGE_PARAMETERS), [tag, names, createArrayExpression(properties.map(property => property.value)), source])
        if (context.scopes.vFor === 0 && context.scopes.vSlot === 0 && !parameters.shouldUseBlock) props = context.cache(props)
    }
    node.codegenNode = createVNodeCall(context, tag, props, children, flags || undefined, parameters.dynamicPropNames.length ? JSON.stringify(parameters.dynamicPropNames) : undefined, parameters.shouldUseBlock, false, isArrangable, node.loc)
}

export function resolveArrangableType(node: ArrangableNode, context: TransformContext): string {
    const fromSetup = resolveSetupReference(node.tag, context)
    if (fromSetup) return fromSetup
    if (context.arrangeTypecheck) return node.tag === context.selfName ? '_sfa_main' : `__Arrange.${node.tag}`
    context.helper(RESOLVE_ARRANGABLE)
    const name = node.tag === context.selfName ? node.tag + '__self' : node.tag
    context.arrangables.add(name)
    return toValidAssetId(name, 'arrangable')
}

function resolveSetupReference(name: string, context: TransformContext) {
    const bindings = context.bindingMetadata
    if (!bindings || bindings.__isScriptSetup === false) {
        return
    }

    const checkType = (type: BindingTypes) => bindings[name] === type ? name : undefined

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

export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode | CacheExpression

export function buildProps(node: ElementNode, context: TransformContext): { props: PropsExpression | undefined; patchFlag: number; dynamicPropNames: string[]; shouldUseBlock: boolean } {
    let properties: Property[] = []
    const operands: PropsExpression[] = []
    const names = new Set<string>()
    const dynamicPropNames: string[] = []
    let hasDynamicKeys = false
    let shouldUseBlock = false
    const flush = () => {
        if (!properties.length) return
        operands.push(createObjectExpression(properties, node.loc))
        properties = []
    }
    const append = (property: Property) => {
        if (!isStaticExp(property.key)) {
            hasDynamicKeys = true
            flush()
            operands.push(createObjectExpression([property], node.loc))
            return
        }
        const name = property.key.content
        if (names.has(name)) throw new SyntaxError(`重复参数：${name}`)
        names.add(name)
        const value = property.value
        const dynamic = value.type !== NodeTypes.SIMPLE_EXPRESSION && value.type !== NodeTypes.COMPOUND_EXPRESSION || getConstantType(value, context) === ConstantTypes.NOT_CONSTANT
        if (name === 'key') shouldUseBlock = dynamic
        else if (dynamic) dynamicPropNames.push(name)
        properties.push(property)
    }

    for (const parameter of node.props) {
        if (parameter.type === NodeTypes.ATTRIBUTE) {
            append(createObjectProperty(createSimpleExpression(camelize(parameter.name), true, parameter.nameLoc), createSimpleExpression(parameter.value?.content ?? 'true', Boolean(parameter.value), parameter.value?.loc ?? parameter.loc, ConstantTypes.CAN_STRINGIFY)))
            continue
        }
        if (parameter.name === 'slot') continue
        if (parameter.name !== 'bind') throw Object.assign(new SyntaxError(`参数位置不支持 v-${parameter.name}`), { loc: parameter.loc })
        if (!parameter.exp) throw Object.assign(new SyntaxError('参数绑定必须显式提供表达式'), { loc: parameter.loc })
        if (!parameter.arg) {
            hasDynamicKeys = true
            flush()
            operands.push(parameter.exp)
            continue
        }
        const transformed = transformBind(parameter, node, context)
        transformed.props.forEach(append)
    }

    let props: PropsExpression | undefined
    if (operands.length) {
        flush()
        props = createCallExpression(context.helper(MERGE_PROPS), operands, node.loc)
    } else if (properties.length) props = createObjectExpression(properties, node.loc)

    if (props && hasDynamicKeys) {
        const source = JSON.stringify(`${context.filename}:${node.loc.start.line}:${node.loc.start.column} (<${node.tag}>)`)
        props = createCallExpression(context.helper(ARRANGE_PROPS), [createFunctionExpression(undefined, props, true), source])
    } else if (props?.type === NodeTypes.JS_OBJECT_EXPRESSION) {
        for (const property of props.properties) {
            if (!isStaticExp(property.key) || !dynamicPropNames.includes(property.key.content)) continue
            const name = property.key.content
            const split = name === 'modifier' ? splitArrangeModifier(property.value, context) : undefined
            const position = property.key.loc.start
            const source = createSimpleExpression(JSON.stringify(`${context.filename}:${position.line}:${position.column} (${name})`), false)
            if (split?.type === NodeTypes.JS_CALL_EXPRESSION) split.arguments.push(source)
            property.value = split ?? createCallExpression(context.helper(ARRANGE_VALUE), [createFunctionExpression(undefined, property.value, true), source])
        }
    }
    return { props, patchFlag: hasDynamicKeys ? PatchFlags.FULL_PROPS : dynamicPropNames.length ? PatchFlags.PROPS : 0, dynamicPropNames, shouldUseBlock }
}
