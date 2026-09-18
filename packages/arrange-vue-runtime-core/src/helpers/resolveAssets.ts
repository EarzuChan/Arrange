import { camelize, capitalize, isString } from '@arrange/vue-shared'
import {
    type ComponentOptions,
    type ConcreteComponent,
    currentInstance,
    getComponentName,
} from '../component.ts'
import { currentRenderingInstance } from '../componentRenderContext.ts'
import type { Directive } from '../directives.ts'
import type { VNodeTypes } from '../vnode.ts'
import { warn } from '../warning.ts'

export const COMPONENTS = 'components'
export const DIRECTIVES = 'directives'

export type AssetTypes = typeof COMPONENTS | typeof DIRECTIVES

/**
 * @private
 */
export function resolveComponent(
    name: string,
    maybeSelfReference?: boolean,
): ConcreteComponent | string {
    return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name
}

export const NULL_DYNAMIC_COMPONENT: unique symbol = Symbol.for('v-ndc')

/**
 * @private
 */
export function resolveDynamicComponent(component: unknown): VNodeTypes {
    if (isString(component)) {
        return resolveAsset(COMPONENTS, component, false) || component
    } else {
        // invalid types will fallthrough to createVNode and raise warning
        return (component || NULL_DYNAMIC_COMPONENT) as any
    }
}

/**
 * @private
 */
export function resolveDirective(name: string): Directive | undefined {
    return resolveAsset(DIRECTIVES, name)
}

/**
 * @private
 * overload 1: components
 */
function resolveAsset(
    type: typeof COMPONENTS,
    name: string,
    warnMissing?: boolean,
    maybeSelfReference?: boolean,
): ConcreteComponent | undefined
// overload 2: directives
function resolveAsset(
    type: typeof DIRECTIVES,
    name: string,
): Directive | undefined
// implementation
function resolveAsset(
    type: AssetTypes,
    name: string,
    warnMissing = true,
    maybeSelfReference = false,
) {
    const instance = currentRenderingInstance || currentInstance
    if (instance) {
        const Component = instance.type

        // explicit self name has highest priority
        if (type === COMPONENTS) {
            const selfName = getComponentName(
                Component,
                false /* do not include inferred name to avoid breaking existing code */,
            )
            if (
                selfName &&
                (selfName === name ||
                    selfName === camelize(name) ||
                    selfName === capitalize(camelize(name)))
            ) {
                return Component
            }
        }

        const res =
            // 先解析组件本身的局部注册，再解析应用注册
            resolve((Component as ComponentOptions)[type], name) ||
            // global registration
            resolve(instance.appContext[type], name)

        if (!res && maybeSelfReference) {
            // fallback to implicit self-reference
            return Component
        }

        if (__DEV__ && warnMissing && !res) {
            warn(`无法解析 ${type.slice(0, -1)}：${name}`)
        }

        return res
    } else if (__DEV__) {
        warn(
            `resolve${capitalize(type.slice(0, -1))} ` +
            `can only be used in render() or setup().`,
        )
    }
}

function resolve(registry: Record<string, any> | undefined, name: string) {
    return (
        registry &&
        (registry[name] ||
            registry[camelize(name)] ||
            registry[capitalize(camelize(name))])
    )
}
