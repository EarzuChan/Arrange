import type { LooseRequired } from '@arrange/vue-shared'
import { arrangableOptionNames, isArray, isObject } from '@arrange/vue-shared'
import type { Arrangable, ArrangableInternalOptions, ConcreteArrangable, SetupContext } from './arrangable.ts'
import type { ArrangablePropsOptions } from './arrangableProps.ts'
import { normalizeDeclaredProps } from './propDeclarations.ts'
import type { ArrangablePublicInstance } from './arrangablePublicInstance.ts'
import type { SlotsType } from './arrangableSlots.ts'
import type { VNodeChild } from './vnode.ts'
import { isFoundationArrangable } from './apiDefineFoundationArrangable.ts'

export type RenderFunction = () => VNodeChild

// Arrangable只声明宿主确实消费的配置，状态与生命周期归 setup
export interface ArrangableOptionsBase<Props = {}, RawBindings = any, S extends SlotsType = {}> extends ArrangableInternalOptions {
    setup?: (this: void, props: LooseRequired<Props>, ctx: SetupContext<S>) => Promise<RawBindings | RenderFunction | void> | RawBindings | RenderFunction | void
    name?: string
    render?: Function
    arrangables?: Record<string, Arrangable>
    slots?: S
    slotNames?: readonly string[]
    __asyncLoader?: () => Promise<ConcreteArrangable>
    __asyncResolved?: ConcreteArrangable
    call?: (this: unknown, ...args: unknown[]) => never
    __isFragment?: never
}

export type ArrangableOptions<Props = {}, RawBindings = any, S extends SlotsType = {}> = ArrangableOptionsBase<Props, RawBindings, S> & {
    props?: ArrangablePropsOptions<Props>
} & ThisType<ArrangablePublicInstance<Props, RawBindings, {}, {}, false, S>>

// JS、手写 render 与动态Arrangable在同一入口校验，SFA 的 __file 保留错误归属
export function validateArrangableOptions(arrangable: ArrangableOptions): void {
    if (isFoundationArrangable(arrangable)) return
    if (!isObject(arrangable) || isArray(arrangable)) throw new TypeError('Arrange Arrangable配置必须是对象')
    const fail = (message: string): never => { throw new TypeError(message + (arrangable.__file ? '\n来源：' + arrangable.__file : '')) }

    for (const key of Object.keys(arrangable)) {
        if (!arrangableOptionNames.has(key)) fail('Arrange Arrangable配置未定义：' + key)
    }

    normalizeDeclaredProps(arrangable.props)

    for (const key of ['setup', 'render'] as const) {
        if (arrangable[key] !== undefined && typeof arrangable[key] !== 'function') fail('Arrange Arrangable配置 ' + key + ' 必须是函数')
    }
    if (arrangable.slotNames && (!Array.isArray(arrangable.slotNames) || arrangable.slotNames.some(name => typeof name !== 'string' || !name) || new Set(arrangable.slotNames).size !== arrangable.slotNames.length)) fail('Arrangable 内容声明必须由不重复的非空名称组成')
    if (arrangable.name !== undefined && typeof arrangable.name !== 'string') fail('Arrange Arrangable配置 name 必须是字符串')

    for (const key of ['props', 'arrangables', 'slots'] as const) {
        const value = arrangable[key]
        if (value === undefined) continue
        if (isArray(value) && key === 'props') {
            if (!value.every(item => typeof item === 'string')) fail('Arrange Arrangable配置 ' + key + ' 数组仅接受字符串')
        } else if (!isObject(value) || isArray(value)) fail('Arrange Arrangable配置 ' + key + ' 必须是配置对象')
    }
}
