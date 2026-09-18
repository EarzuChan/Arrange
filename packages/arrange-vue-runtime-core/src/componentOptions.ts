import type { LooseRequired } from '@arrange/vue-shared'
import { componentOptionNames, isArray, isObject } from '@arrange/vue-shared'
import type { Component, ComponentInternalOptions, ConcreteComponent, SetupContext } from './component.ts'
import type { EmitsOptions } from './componentEmits.ts'
import type { ComponentPropsOptions } from './componentProps.ts'
import type { ComponentPublicInstance } from './componentPublicInstance.ts'
import type { SlotsType } from './componentSlots.ts'
import type { Directive } from './directives.ts'
import type { VNodeChild } from './vnode.ts'

export type RenderFunction = () => VNodeChild

// 组件只声明宿主确实消费的配置，状态与生命周期归 setup
export interface ComponentOptionsBase<Props = {}, RawBindings = any, E extends EmitsOptions = any, S extends SlotsType = {}> extends ComponentInternalOptions {
    setup?: (this: void, props: LooseRequired<Props>, ctx: SetupContext<E, S>) => Promise<RawBindings | RenderFunction | void> | RawBindings | RenderFunction | void
    name?: string
    render?: Function
    components?: Record<string, Component>
    directives?: Record<string, Directive>
    inheritAttrs?: boolean
    emits?: E
    slots?: S
    __asyncLoader?: () => Promise<ConcreteComponent>
    __asyncResolved?: ConcreteComponent
    __isKeepAlive?: boolean
    call?: (this: unknown, ...args: unknown[]) => never
    __isFragment?: never
    __isTeleport?: never
    __isSuspense?: never
}

export type ComponentOptions<Props = {}, RawBindings = any, E extends EmitsOptions = any, S extends SlotsType = {}> = ComponentOptionsBase<Props, RawBindings, E, S> & {
    props?: ComponentPropsOptions<Props>
} & ThisType<ComponentPublicInstance<Props, RawBindings, E, {}, {}, false, S>>

// JS、手写 render 与动态组件在同一入口校验，SFC 的 __file 保留错误归属
export function validateComponentOptions(component: ComponentOptions): void {
    if (!isObject(component) || isArray(component)) throw new TypeError('Arrange 组件配置必须是对象')
    const fail = (message: string): never => { throw new TypeError(message + (component.__file ? '\n来源：' + component.__file : '')) }

    for (const key of Object.keys(component)) {
        if (!componentOptionNames.has(key)) fail('Arrange 组件配置未定义：' + key)
    }

    for (const key of ['setup', 'render'] as const) {
        if (component[key] !== undefined && typeof component[key] !== 'function') fail('Arrange 组件配置 ' + key + ' 必须是函数')
    }
    if (component.name !== undefined && typeof component.name !== 'string') fail('Arrange 组件配置 name 必须是字符串')
    if (component.inheritAttrs !== undefined && typeof component.inheritAttrs !== 'boolean') fail('Arrange 组件配置 inheritAttrs 必须是布尔值')

    for (const key of ['props', 'emits', 'components', 'directives', 'slots'] as const) {
        const value = component[key]
        if (value === undefined) continue
        if (isArray(value) && (key === 'props' || key === 'emits')) {
            if (!value.every(item => typeof item === 'string')) fail('Arrange 组件配置 ' + key + ' 数组仅接受字符串')
        } else if (!isObject(value) || isArray(value)) fail('Arrange 组件配置 ' + key + ' 必须是配置对象')
    }
}
