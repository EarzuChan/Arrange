import { BindingTypes, isFunctionType, unwrapTSNode } from '../../template/index.ts'
import type { Expression, LVal, Node, ObjectExpression, ObjectMethod, ObjectProperty } from '@babel/types'
import { getObjectOrArrayExpressionKeys } from './analyzeScriptBindings.ts'
import type { ScriptCompileContext } from './context.ts'
import { processPropsDestructure } from './definePropsDestructure.ts'
import { type TypeResolveContext, inferRuntimeType, inferRefContract, resolveTypeElements } from './resolveType.ts'
import { UNKNOWN_TYPE, concatStrings, getEscapedPropName, isCallOf, isLiteralNode, resolveObjectKey, toRuntimeTypeString } from './utils.ts'

export const DEFINE_PROPS = 'defineProps'
export const WITH_DEFAULTS = 'withDefaults'

export interface PropTypeData {
    key: string
    type: string[]
    required: boolean
    skipCheck: boolean
    refKind?: string
}

export type PropsDestructureBindings = Record<
    string, // public prop key
    {
        local: string // local identifier, may be different
        default?: Expression
    }
>

export function processDefineProps(ctx: ScriptCompileContext, node: Node, declId?: LVal, isWithDefaults = false): boolean {
    if (!isCallOf(node, DEFINE_PROPS)) {
        return processWithDefaults(ctx, node, declId)
    }

    if (ctx.hasDefinePropsCall) {
        ctx.error(`duplicate ${DEFINE_PROPS}() call`, node)
    }
    ctx.hasDefinePropsCall = true
    ctx.propsRuntimeDecl = node.arguments[0]

    // register bindings
    if (ctx.propsRuntimeDecl) {
        for (const key of getObjectOrArrayExpressionKeys(ctx.propsRuntimeDecl)) {
            if (!(key in ctx.bindingMetadata)) {
                ctx.bindingMetadata[key] = BindingTypes.PROPS
            }
        }
    }

    // call has type parameters - infer runtime types from it
    if (node.typeParameters) {
        if (ctx.propsRuntimeDecl) {
            ctx.error(`${DEFINE_PROPS}() cannot accept both type and non-type arguments ` + `at the same time. Use one or the other.`, node)
        }
        ctx.propsTypeDecl = node.typeParameters.params[0]
    }

    // handle props destructure
    if (!isWithDefaults && declId && declId.type === 'ObjectPattern') {
        processPropsDestructure(ctx, declId)
    }

    ctx.propsCall = node
    ctx.propsDecl = declId

    return true
}

function processWithDefaults(ctx: ScriptCompileContext, node: Node, declId?: LVal): boolean {
    if (!isCallOf(node, WITH_DEFAULTS)) {
        return false
    }
    if (
        !processDefineProps(
            ctx,
            node.arguments[0],
            declId,
            true /* isWithDefaults */,
        )
    ) {
        ctx.error(`${WITH_DEFAULTS}' first argument must be a ${DEFINE_PROPS} call.`, node.arguments[0] || node)
    }

    if (ctx.propsRuntimeDecl) {
        ctx.error(`${WITH_DEFAULTS} can only be used with type-based ` + `${DEFINE_PROPS} declaration.`, node)
    }
    if (declId && declId.type === 'ObjectPattern') {
        ctx.warn(`${WITH_DEFAULTS}() is unnecessary when using destructure with ${DEFINE_PROPS}().\n` + `Reactive destructure will be disabled when using withDefaults().\n` + `Prefer using destructure default values, e.g. const { foo = 1 } = defineProps(...). `, node.callee)
    }
    ctx.propsRuntimeDefaults = node.arguments[1]
    if (!ctx.propsRuntimeDefaults) {
        ctx.error(`The 2nd argument of ${WITH_DEFAULTS} is required.`, node)
    }
    ctx.propsCall = node

    return true
}

export function genRuntimeProps(ctx: ScriptCompileContext): string | undefined {
    let propsDecls: undefined | string

    if (ctx.propsRuntimeDecl) {
        propsDecls = ctx.getString(ctx.propsRuntimeDecl).trim()
        if (ctx.propsDestructureDecl) {
            const defaults: string[] = []
            for (const key in ctx.propsDestructuredBindings) {
                const d = genDestructuredDefaultValue(ctx, key)
                const finalKey = getEscapedPropName(key)
                if (d)
                    defaults.push(`${finalKey}: ${d.valueString}${d.needSkipFactory ? `, __skip_${finalKey}: true` : ``}`)
            }
            if (defaults.length) {
                propsDecls = `/*@__PURE__*/${ctx.helper(`mergeDefaults`)}(${propsDecls}, {\n  ${defaults.join(',\n  ')}\n})`
            }
        }
    } else if (ctx.propsTypeDecl) {
        propsDecls = extractRuntimeProps(ctx)
    }

    return propsDecls
}

export function extractRuntimeProps(ctx: TypeResolveContext): string | undefined {
    // this is only called if propsTypeDecl exists
    const props = resolveRuntimePropsFromType(ctx, ctx.propsTypeDecl!)
    if (!props.length) {
        return
    }

    const propStrings: string[] = []
    const hasStaticDefaults = hasStaticWithDefaults(ctx)

    for (const prop of props) {
        propStrings.push(genRuntimePropFromType(ctx, prop, hasStaticDefaults))
        // register bindings
        if ('bindingMetadata' in ctx && !(prop.key in ctx.bindingMetadata)) {
            ctx.bindingMetadata[prop.key] = BindingTypes.PROPS
        }
    }

    let propsDecls = `{
    ${propStrings.join(',\n    ')}\n  }`

    if (ctx.propsRuntimeDefaults && !hasStaticDefaults) {
        propsDecls = `/*@__PURE__*/${ctx.helper('mergeDefaults')}(${propsDecls}, ${ctx.getString(ctx.propsRuntimeDefaults)})`
    }

    return propsDecls
}

function resolveRuntimePropsFromType(ctx: TypeResolveContext, node: Node): PropTypeData[] {
    const props: PropTypeData[] = []
    const elements = resolveTypeElements(ctx, node)
    for (const key in elements.props) {
        const e = elements.props[key]
        const annotation = e.type === 'TSPropertySignature' ? e.typeAnnotation?.typeAnnotation : undefined
        const refKind = inferRefContract(ctx, annotation, e._ownerScope)
        let type = refKind ? ['Object'] : inferRuntimeType(ctx, e)
        let skipCheck = false
        // 显式 any/unknown 是作者声明的开放边界，无法解析的类型不能偷偷退化
        if (type.includes(UNKNOWN_TYPE)) {
            if (annotation?.type === 'TSAnyKeyword' || annotation?.type === 'TSUnknownKeyword') type = ['null']
            else ctx.error(`参数 ${key} 的运行时类型无法从声明提取，请提供可解析的明确契约`, e)
        }
        props.push({
            key,
            required: !e.optional,
            type: type || [`null`],
            skipCheck,
            refKind,
        })
    }
    return props
}

function genRuntimePropFromType(ctx: TypeResolveContext, { key, required, type, skipCheck, refKind }: PropTypeData, hasStaticDefaults: boolean): string {
    let defaultString: string | undefined
    const destructured = genDestructuredDefaultValue(ctx, key, type)
    if (destructured) {
        defaultString = `default: ${destructured.valueString}${destructured.needSkipFactory ? `, skipFactory: true` : ``}`
    } else if (hasStaticDefaults) {
        const prop = (ctx.propsRuntimeDefaults as ObjectExpression).properties.find(
            node => {
                if (node.type === 'SpreadElement') return false
                return resolveObjectKey(node.key, node.computed) === key
            },
        ) as ObjectProperty | ObjectMethod
        if (prop) {
            if (prop.type === 'ObjectProperty') {
                // prop has corresponding static default value
                defaultString = `default: ${ctx.getString(prop.value)}`
            } else {
                let paramsString = ''
                if (prop.params.length) {
                    const start = prop.params[0].start
                    const end = prop.params[prop.params.length - 1].end
                    paramsString = ctx.getString({ start, end } as Node)
                }
                defaultString = `${prop.async ? 'async ' : ''}${prop.kind !== 'method' ? `${prop.kind} ` : ''}default(${paramsString}) ${ctx.getString(prop.body)}`
            }
        }
    }

    const finalKey = getEscapedPropName(key)
    return `${finalKey}: { ${concatStrings([
        `type: ${toRuntimeTypeString(refKind ? ['Object'] : type)} as ${ctx.helper('PropType')}<(${ctx.getString(ctx.propsTypeDecl!)})[${JSON.stringify(key)}]>`,
        `required: ${required}`,
        refKind && `refKind: '${refKind}'`,
        defaultString,
    ])} }`

}

/**
 * check defaults. If the default object is an object literal with only
 * static properties, we can directly generate more optimized default
 * declarations. Otherwise we will have to fallback to runtime merging.
 */
function hasStaticWithDefaults(ctx: TypeResolveContext) {
    return !!(ctx.propsRuntimeDefaults && ctx.propsRuntimeDefaults.type === 'ObjectExpression' && ctx.propsRuntimeDefaults.properties.every(node => node.type !== 'SpreadElement' && (!node.computed || node.key.type.endsWith('Literal'))))
}

function genDestructuredDefaultValue(ctx: TypeResolveContext, key: string, inferredType?: string[]):
    | {
        valueString: string
        needSkipFactory: boolean
    }
    | undefined {
    const destructured = ctx.propsDestructuredBindings[key]
    const defaultVal = destructured && destructured.default
    if (defaultVal) {
        const value = ctx.getString(defaultVal)
        const unwrapped = unwrapTSNode(defaultVal)

        if (inferredType && inferredType.length && !inferredType.includes('null')) {
            const valueType = inferValueType(unwrapped)
            if (valueType && !inferredType.includes(valueType)) {
                ctx.error(`Default value of prop "${key}" does not match declared type.`, unwrapped)
            }
        }

        // If the default value is a function or is an identifier referencing
        // external value, skip factory wrap. This is needed when using
        // destructure w/ runtime declaration since we cannot safely infer
        // whether the expected runtime prop type is `Function`.
        const needSkipFactory = !inferredType && (isFunctionType(unwrapped) || unwrapped.type === 'Identifier')

        const needFactoryWrap = !needSkipFactory && !isLiteralNode(unwrapped) && !inferredType?.includes('Function')

        return {
            valueString: needFactoryWrap ? `() => (${value})` : value,
            needSkipFactory,
        }
    }
}

// non-comprehensive, best-effort type inference for a runtime value
// this is used to catch default value / type declaration mismatches
// when using props destructure.
function inferValueType(node: Node): string | undefined {
    switch (node.type) {
        case 'StringLiteral':
            return 'String'
        case 'NumericLiteral':
            return 'Number'
        case 'BooleanLiteral':
            return 'Boolean'
        case 'ObjectExpression':
            return 'Object'
        case 'ArrayExpression':
            return 'Array'
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            return 'Function'
    }
}