import { ReactiveFlags, type ShallowUnwrapRef, TrackOpTypes, shallowReadonly, toRaw, track } from '@arrange/vue-reactivity'
import { EMPTY_OBJ, type IfAny, NOOP, type Prettify, extend, hasOwn, isString } from '@arrange/vue-shared'
import { type OnCleanup, type WatchOptions, type WatchStopHandle, instanceWatch } from './apiWatch.ts'
import type { RendererElement } from './renderer.ts'
import { type ArrangableInstance, type Data, getArrangablePublicInstance, isStatefulArrangable } from './arrangable.ts'
import type { ArrangableOptions } from './arrangableOptions.ts'
import { currentRenderingInstance } from './arrangableRenderContext.ts'
import type { SlotsType, UnwrapSlotsType } from './arrangableSlots.ts'
import { nextTick, queueJob } from './scheduler.ts'
import { warn } from './warning.ts'

export interface ArrangableCustomProperties {}

export type ArrangablePublicInstanceConstructor<T extends ArrangablePublicInstance<any> = ArrangablePublicInstance<any>> = {
    __isFragment?: never
    new (...args: any[]): T
}

// 实例只暴露 props、setup 返回值及真正实现的实例方法
export type ArrangablePublicInstance<P = {}, B = {}, PublicProps = {}, Defaults = {}, MakeDefaultsOptional extends boolean = false, S extends SlotsType = {}, TypeRefs extends Data = {}, TypeEl extends RendererElement = any> = {
    $: ArrangableInstance
    $props: MakeDefaultsOptional extends true ? Partial<Defaults> & Omit<Prettify<P> & PublicProps, keyof Defaults> : Prettify<P> & PublicProps
    $slots: UnwrapSlotsType<S>
    $root: ArrangablePublicInstance | null
    $parent: ArrangablePublicInstance | null
    $el: TypeEl
    $options: ArrangableOptions<P, B, S>
    $forceUpdate: () => void
    $nextTick: typeof nextTick
    $watch<T extends string | ((...args: any) => any)>(source: T, cb: T extends (...args: any) => infer R ? (...args: [R, R, OnCleanup]) => any : (...args: [any, any, OnCleanup]) => any, options?: WatchOptions): WatchStopHandle
} & IfAny<P, P, Readonly<Defaults> & Omit<P, keyof ShallowUnwrapRef<B> | keyof Defaults>> & ShallowUnwrapRef<B> & ArrangableCustomProperties

export type PublicPropertiesMap = Record<
    string,
    (i: ArrangableInstance) => any
>

/**
 * #2437 In Vue 3, functional arrangables do not have a public instance proxy but
 * they exist in the internal parent chain. For code that relies on traversing
 * public $parent chains, skip functional ones and go to the parent instead.
 */
const getPublicInstance = (
    i: ArrangableInstance | null,
): ArrangablePublicInstance | null => {
    if (!i) return null
    if (isStatefulArrangable(i)) return getArrangablePublicInstance(i)
    return getPublicInstance(i.parent)
}

export const publicPropertiesMap: PublicPropertiesMap =
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /*@__PURE__*/ extend(Object.create(null), {
    $: i => i,
    $el: i => i.vnode.el,
    $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
    $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
    $parent: i => getPublicInstance(i.parent),
    $root: i => getPublicInstance(i.root),
    $options: i => i.type,
    $forceUpdate: i =>
        i.f ||
        (i.f = () => {
            queueJob(i.update)
        }),
    $nextTick: i => i.n || (i.n = nextTick.bind(i.proxy!)),
    $watch: i => instanceWatch.bind(i),
} as PublicPropertiesMap)

enum AccessTypes {
    OTHER,
    SETUP,
    PROPS,
    CONTEXT,
}

export interface ArrangableRenderContext {
    [key: string]: any
    _: ArrangableInstance
}

export const isReservedPrefix = (key: string): key is '_' | '$' =>
    key === '_' || key === '$'

const hasSetupBinding = (state: Data, key: string) =>
    state !== EMPTY_OBJ && !state.__isScriptSetup && hasOwn(state, key)

export const PublicInstanceProxyHandlers: ProxyHandler<any> = {
    get({ _: instance }: ArrangableRenderContext, key: string) {
        if (key === ReactiveFlags.SKIP) {
            return true
        }

        const { ctx, setupState, props, accessCache, type, appContext } =
            instance

        // for internal formatters to know that this is a Vue instance
        if (__DEV__ && key === '__isVue') {
            return true
        }

        // data / props / ctx
        // This getter gets called for every property access on the render context
        // during render and is a major hotspot. The most expensive part of this
        // is the multiple hasOwn() calls. It's much faster to do a simple property
        // access on a plain object, so we use an accessCache object (with null
        // prototype) to memoize what access type a key corresponds to.
        if (key[0] !== '$') {
            const n = accessCache![key]
            if (n !== undefined) {
                switch (n) {
                    case AccessTypes.SETUP:
                        return setupState[key]
                    case AccessTypes.CONTEXT:
                        return ctx[key]
                    case AccessTypes.PROPS:
                        return props![key]
                    // default: just fallthrough
                }
            } else if (hasSetupBinding(setupState, key)) {
                accessCache![key] = AccessTypes.SETUP
                return setupState[key]
            } else if (hasOwn(props, key)) {
                accessCache![key] = AccessTypes.PROPS
                return props![key]
            } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
                accessCache![key] = AccessTypes.CONTEXT
                return ctx[key]
            } else {
                accessCache![key] = AccessTypes.OTHER
            }
        }

        const publicGetter = publicPropertiesMap[key]
        let globalProperties
        // public $xxx properties
        if (publicGetter) {
            if (__DEV__ && key === '$slots') {
                // for HMR only
                track(instance, TrackOpTypes.GET, key)
            }
            return publicGetter(instance)
        } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
            // user may set custom properties to `this` that start with `$`
            accessCache![key] = AccessTypes.CONTEXT
            return ctx[key]
        } else if (
            // global properties
            ((globalProperties = appContext.config.globalProperties),
                hasOwn(globalProperties, key))
        ) {
            {
                return globalProperties[key]
            }
        } else if (
            __DEV__ &&
            currentRenderingInstance &&
            (!isString(key) ||
                // #1091 avoid internal isRef/isVNode checks on arrangable instance leading
                // to infinite warning loop
                key.indexOf('__v') !== 0)
        ) {
            if (instance === currentRenderingInstance) {
                warn(
                    `Property ${JSON.stringify(key)} was accessed during render ` +
                    `but is not defined on instance.`,
                )
            }
        }
    },
    set(
        { _: instance }: ArrangableRenderContext,
        key: string,
        value: any,
    ): boolean {
        const { setupState, ctx } = instance
        if (hasSetupBinding(setupState, key)) {
            setupState[key] = value
            return true
        } else if (
            __DEV__ &&
            setupState.__isScriptSetup &&
            hasOwn(setupState, key)
        ) {
            warn(`不能通过Arrangable公开实例修改 <script setup> 绑定 "${key}"`)
            return false
        } else if (hasOwn(instance.props, key)) {
            __DEV__ && warn(`Attempting to mutate prop "${key}". Props are readonly.`)
            return false
        }
        if (key[0] === '$' && key.slice(1) in instance) {
            __DEV__ &&
                warn(
                    `Attempting to mutate public property "${key}". ` +
                    `Properties starting with $ are reserved and readonly.`,
                )
            return false
        } else {
            if (__DEV__ && key in instance.appContext.config.globalProperties) {
                Object.defineProperty(ctx, key, {
                    enumerable: true,
                    configurable: true,
                    value,
                })
            } else {
                ctx[key] = value
            }
        }
        return true
    },
    has(
        {
            _: { setupState, accessCache, ctx, appContext, props },
        }: ArrangableRenderContext,
        key: string,
    ) {
        return !!(
            accessCache![key] ||
            hasSetupBinding(setupState, key) ||
            hasOwn(props, key) ||
            hasOwn(ctx, key) ||
            hasOwn(publicPropertiesMap, key) ||
            hasOwn(appContext.config.globalProperties, key)
        )
    },
    defineProperty(
        target: ArrangableRenderContext,
        key: string,
        descriptor: PropertyDescriptor,
    ) {
        if (descriptor.get != null) {
            // invalidate key cache of a getter based property #5417
            target._.accessCache![key] = 0
        } else if (hasOwn(descriptor, 'value')) {
            this.set!(target, key, descriptor.value, null)
        }
        return Reflect.defineProperty(target, key, descriptor)
    },
}

if (__DEV__ && !__TEST__) {
    PublicInstanceProxyHandlers.ownKeys = (target: ArrangableRenderContext) => {
        warn(
            `Avoid app logic that relies on enumerating keys on a arrangable instance. ` +
            `The keys will be empty in production mode to avoid performance overhead.`,
        )
        return Reflect.ownKeys(target)
    }
}

// dev only
// In dev mode, the proxy target exposes the same properties as seen on `this`
// for easier console inspection. In prod mode it will be an empty object so
// these properties definitions can be skipped.
export function createDevRenderContext(instance: ArrangableInstance) {
    const target: Record<string, any> = {}

    // expose internal instance for proxy handlers
    Object.defineProperty(target, `_`, {
        configurable: true,
        enumerable: false,
        get: () => instance,
    })

    // expose public properties
    Object.keys(publicPropertiesMap).forEach(key => {
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: false,
            get: () => publicPropertiesMap[key](instance),
            // intercepted by the proxy so no need for implementation,
            // but needed to prevent set errors
            set: NOOP,
        })
    })

    return target as ArrangableRenderContext
}

// dev only
export function exposePropsOnRenderContext(
    instance: ArrangableInstance,
): void {
    const {
        ctx,
        propsOptions: [propsOptions],
    } = instance
    if (propsOptions) {
        Object.keys(propsOptions).forEach(key => {
            Object.defineProperty(ctx, key, {
                enumerable: true,
                configurable: true,
                get: () => instance.props[key],
                set: NOOP,
            })
        })
    }
}

// dev only
export function exposeSetupStateOnRenderContext(
    instance: ArrangableInstance,
): void {
    const { ctx, setupState } = instance
    Object.keys(toRaw(setupState)).forEach(key => {
        if (!setupState.__isScriptSetup) {
            if (isReservedPrefix(key[0])) {
                warn(
                    `setup() return property ${JSON.stringify(
                        key,
                    )} should not start with "$" or "_" ` +
                    `which are reserved prefixes for Vue internals.`,
                )
                return
            }
            Object.defineProperty(ctx, key, {
                enumerable: true,
                configurable: true,
                get: () => setupState[key],
                set: NOOP,
            })
        }
    })
}
