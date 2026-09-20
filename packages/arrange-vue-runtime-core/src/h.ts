import {type IfAny, isArray, isObject} from '@arrange/vue-shared'
import type {DefineArrangable} from './apiDefineArrangable.ts'
import type {Arrangable, ArrangableOptions, ConcreteArrangable, FunctionalArrangable,} from './arrangable.ts'
import type {RawSlots} from './arrangableSlots.ts'
import type {ValueExpression} from './valueBinding.ts'
import {type Comment, type Fragment, type VNode, type VNodeArrayChildren, type VNodeProps, createVNode, isVNode, setBlockTracking,} from './vnode.ts'

type ValueProps<P> = { [K in keyof P]: K extends keyof VNodeProps ? P[K] : P[K] | ValueExpression<P[K]> }

type RawProps = VNodeProps & { __v_isVNode?: never, [Symbol.iterator]?: never } & Record<string, any>

type RawChildren = boolean | VNode | VNodeArrayChildren | (() => any)

// fake constructor type returned from `defineArrangable`
interface Constructor<P = any> {
    __isFragment?: never

    new(...args: any[]): { $props: P }
}

// 原生宿主名称
export function h(type: string, children?: RawChildren): VNode
export function h(type: string, props?: RawProps | null, children?: RawChildren | RawSlots,): VNode

// text/comment
export function h(type: typeof Comment, children?: string | number | boolean,): VNode
export function h(type: typeof Comment, props?: null, children?: string | number | boolean,): VNode

// fragment
export function h(type: typeof Fragment, children?: VNodeArrayChildren): VNode
export function h(type: typeof Fragment, props?: RawProps | null, children?: VNodeArrayChildren,): VNode

// functional arrangable
export function h<P, S extends Record<string, any> = any, >(type: FunctionalArrangable<P, S>, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren | IfAny<S, RawSlots, S>,): VNode

// catch-all for generic arrangable types
export function h(type: Arrangable, children?: RawChildren): VNode

// concrete arrangable
export function h<P>(type: ConcreteArrangable | string, children?: RawChildren,): VNode
export function h<P>(type: ConcreteArrangable<P> | string, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren,): VNode

// arrangable without props
export function h<P>(type: Arrangable<P>, props?: (RawProps & ValueProps<P>) | null, children?: RawChildren | RawSlots,): VNode

// exclude `defineArrangable` constructors
export function h<P>(type: ArrangableOptions<P>, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren | RawSlots,): VNode

// fake constructor type returned by `defineArrangable` or class arrangable
export function h(type: Constructor, children?: RawChildren): VNode
export function h<P>(type: Constructor<P>, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren | RawSlots,): VNode

// fake constructor type returned by `defineArrangable`
export function h(type: DefineArrangable, children?: RawChildren): VNode
export function h<P>(type: DefineArrangable<P>, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren | RawSlots,): VNode

// 捕捉所有类型
export function h(type: string | Arrangable, children?: RawChildren): VNode
export function h<P>(type: string | Arrangable<P>, props?: (RawProps & ValueProps<P>) | ({} extends P ? null : never), children?: RawChildren | RawSlots,): VNode

// 实际实现
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
    try {
        // 原Vue（非我Arrange）的FIXME：#6913 h里禁止追踪块。何意味？
        setBlockTracking(-1)

        const l = arguments.length
        if (l === 2) {
            // 忽略Props
            if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
                // 无Props
                if (isVNode(propsOrChildren)) return createVNode(type, null, [propsOrChildren])
                // 没有子的Props
                return createVNode(type, propsOrChildren)
            } else return createVNode(type, null, propsOrChildren)
        } else {
            if (l > 3) children = Array.prototype.slice.call(arguments, 2)
            else if (l === 3 && isVNode(children)) children = [children]

            return createVNode(type, propsOrChildren, children)
        }
    } finally {
        setBlockTracking(1)
    }
}
