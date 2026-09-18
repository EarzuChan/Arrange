import {
    EffectScope,
    type ReactiveEffect,
    TrackOpTypes,
    isRef,
    markRaw,
    pauseTracking,
    proxyRefs,
    resetTracking,
    shallowReadonly,
    track,
} from '@arrange/vue-reactivity'
import {
    EMPTY_OBJ,
    type IfAny,
    NOOP,
    ShapeFlags,
    extend,
    isArray,
    isFunction,
    isObject,
    isPromise,
    makeMap
} from '@arrange/vue-shared'
import {
    type AppConfig,
    type AppContext,
    createAppContext,
} from './apiCreateApp.ts'
import {
    type EmitFn,
    type EmitsOptions,
    type EmitsToProps,
    type ObjectEmitsOptions,
    type ShortEmitsToObject,
    emit,
    normalizeEmitsOptions,
} from './componentEmits.ts'
import { type ComponentOptions, validateComponentOptions } from './componentOptions.ts'
import {
    type ComponentPropsOptions,
    type NormalizedPropsOptions,
    initProps,
    normalizePropsOptions,
} from './componentProps.ts'
import {
    type ComponentPublicInstance,
    type ComponentPublicInstanceConstructor,
    PublicInstanceProxyHandlers,
    createDevRenderContext,
    exposePropsOnRenderContext,
    exposeSetupStateOnRenderContext,
    publicPropertiesMap,
} from './componentPublicInstance.ts'
import { currentRenderingInstance } from './componentRenderContext.ts'
import { markAttrsAccessed } from './componentRenderUtils.ts'
import type { SuspenseBoundary } from './components/Suspense.ts'
import {
    type InternalSlots,
    type Slots,
    type SlotsType,
    type UnwrapSlotsType,
    initSlots,
} from './componentSlots.ts'
import { validateDirectiveName } from './directives.ts'
import type { LifecycleHooks } from './enums.ts'
import { ErrorCodes, callWithErrorHandling, handleError } from './errorHandling.ts'

import type { SchedulerJob } from './scheduler.ts'
import { type VNode, type VNodeChild, isVNode } from './vnode.ts'
import { warn } from './warning.ts'

// Augment GlobalComponents
import { isAsyncWrapper } from './apiAsyncComponent.ts'
import type { DefineComponent } from './apiDefineComponent.ts'
import type { BaseTransitionProps } from './components/BaseTransition.ts'
import type { KeepAliveProps } from './components/KeepAlive.ts'
import type { SuspenseProps } from './components/Suspense.ts'
import type { TeleportProps } from './components/Teleport.ts'
import { markAsyncBoundary } from './helpers/useId.ts'
import type { RendererElement } from './renderer.ts'

export type Data = Record<string, unknown>

/**
 * For extending allowed non-declared attrs on components in TSX
 */
export interface AllowedAttrs { }

export type Attrs = Data & AllowedAttrs

/**
 * Public utility type for extracting the instance type of a component.
 * Works with all valid component definition types. This is intended to replace
 * the usage of `InstanceType<typeof Comp>` which only works for
 * constructor-based component definition types.
 *
 * @example
 * ```ts
 * const MyComp = { ... }
 * declare const instance: ComponentInstance<typeof MyComp>
 * ```
 */
export type ComponentInstance<T> = T extends { new (): ComponentPublicInstance } ? InstanceType<T> : T extends FunctionalComponent<infer Props, infer Emits> ? ComponentPublicInstance<Props, {}, ShortEmitsToObject<Emits>> : T extends Component<infer Props, infer Bindings> ? Props extends { $props: unknown } ? Props : ComponentPublicInstance<unknown extends Props ? {} : Props, unknown extends Bindings ? {} : Bindings> : never

/**
 * For extending allowed non-declared props on components in TSX
 */
export interface ComponentCustomProps { }

/**
 * For globally defined Directives
 * Here is an example of adding a directive `VTooltip` as global directive:
 *
 * @example
 * ```ts
 * import VTooltip from 'v-tooltip'
 *
 * declare module '@arrange/vue-runtime-core' {
 *   interface GlobalDirectives {
 *     VTooltip
 *   }
 * }
 * ```
 */
export interface GlobalDirectives { }

/**
 * For globally defined Components
 * Here is an example of adding a component `RouterView` as global component:
 *
 * @example
 * ```ts
 *
import { RouterView } from 'vue-router'
 *
 * declare module '@arrange/vue-runtime-core' {
 *   interface GlobalComponents {
 *     RouterView
 *   }
 * }
 * ```
 */
export interface GlobalComponents {
    Teleport: DefineComponent<TeleportProps>
    Suspense: DefineComponent<SuspenseProps>
    KeepAlive: DefineComponent<KeepAliveProps>
    BaseTransition: DefineComponent<BaseTransitionProps>
}

/**
 * Default allowed non-declared props on component in TSX
 */
export interface AllowedComponentProps {
}

// Note: can't mark this whole interface internal because some public interfaces
// extend it.
export interface ComponentInternalOptions {
    /**
     * @internal
     */

    /**
     * @internal
     */
    /**
     * @internal
     */
    __hmrId?: string
    /**
     * This one should be exposed so that devtools can make use of it
     */
    __file?: string
    /**
     * name inferred from filename
     */
    __name?: string
}

export interface FunctionalComponent<
    P = {},
    E extends EmitsOptions | Record<string, any[]> = {},
    S extends Record<string, any> = any,
    EE extends EmitsOptions = ShortEmitsToObject<E>,
> extends ComponentInternalOptions {
    // use of any here is intentional so it can be a valid JSX Element constructor
    (
        props: P & EmitsToProps<EE>,
        ctx: Omit<SetupContext<EE, IfAny<S, {}, SlotsType<S>>>, 'expose'>,
    ): any
    props?: ComponentPropsOptions<P>
    emits?: EE | (keyof EE)[]
    slots?: IfAny<S, Slots, SlotsType<S>>
    inheritAttrs?: boolean
    displayName?: string
}

export interface ClassComponent {
    new(...args: any[]): ComponentPublicInstance<any, any>
    __vccOpts: ComponentOptions
}

/**
 * Concrete component type matches its actual value: it's either an options
 * object, or a function. Use this where the code expects to work with actual
 * values, e.g. checking if its a function or not. This is mostly for internal
 * implementation code.
 */
export type ConcreteComponent<
    Props = {},
    RawBindings = any,
    E extends EmitsOptions | Record<string, any[]> = {},
    S extends Record<string, any> = any,
> =
    | ComponentOptions<Props, RawBindings>
    | FunctionalComponent<Props, E, S>

/**
 * A type used in public APIs where a component type is expected.
 * The constructor type is an artificial type returned by defineComponent().
 */
export type Component<
    PropsOrInstance = any,
    RawBindings = any,
    E extends EmitsOptions | Record<string, any[]> = {},
    S extends Record<string, any> = any,
> =
    | ConcreteComponent<PropsOrInstance, RawBindings, E, S>
    | ComponentPublicInstanceConstructor<PropsOrInstance>

export type { ComponentOptions }

export type LifecycleHook<TFn = Function> = (TFn & SchedulerJob)[] | null

// use `E extends any` to force evaluating type to fix #2362
export type SetupContext<
    E = EmitsOptions,
    S extends SlotsType = {},
> = E extends any
    ? {
        attrs: Attrs
        slots: UnwrapSlotsType<S>
        emit: EmitFn<E>
        expose: <Exposed extends Record<string, any> = Record<string, any>>(
            exposed?: Exposed,
        ) => void
    }
    : never

/**
 * @internal
 */
export type InternalRenderFunction = {
    (
        ctx: ComponentPublicInstance,
        cache: ComponentInternalInstance['renderCache'],
        // for compiler-optimized bindings
        $props: ComponentInternalInstance['props'],
        $setup: ComponentInternalInstance['setupState'],
    ): VNodeChild
}

/**
 * We expose a subset of properties on the internal instance as they are
 * useful for advanced external libraries and tools.
 */
export interface ComponentInternalInstance {
    uid: number
    type: ConcreteComponent
    parent: ComponentInternalInstance | null
    root: ComponentInternalInstance
    appContext: AppContext
    /**
     * Vnode representing this component in its parent's vdom tree
     */
    vnode: VNode
    /**
     * The pending new vnode from parent updates
     * @internal
     */
    next: VNode | null
    /**
     * Root vnode of this component's own vdom tree
     */
    subTree: VNode
    /**
     * Render effect instance
     */
    effect: ReactiveEffect
    /**
     * Force update render effect
     */
    update: () => void
    /**
     * Render effect job to be passed to scheduler (checks if dirty)
     */
    job: SchedulerJob
    /**
     * The render function that returns vdom tree.
     * @internal
     */
    render: InternalRenderFunction | null

    /**
     * Object containing values this component provides for its descendants
     * @internal
     */
    provides: Data
    /**
     * for tracking useId()
     * first element is the current boundary prefix
     * second number is the index of the useId call within that boundary
     * @internal
     */
    ids: [string, number, number]
    /**
     * Tracking reactive effects (e.g. watchers) associated with this component
     * so that they can be automatically stopped on component unmount
     * @internal
     */
    scope: EffectScope
    /**
     * cache for proxy access type to avoid hasOwnProperty calls
     * @internal
     */
    accessCache: Data | null
    /**
     * cache for render function values that rely on _ctx but won't need updates
     * after initialized (e.g. inline handlers)
     * @internal
     */
    renderCache: (Function | VNode | undefined)[]

    /**
     * resolved props options
     * @internal
     */
    propsOptions: NormalizedPropsOptions
    /**
     * resolved emits options
     * @internal
     */
    emitsOptions: ObjectEmitsOptions | null
    /**
     * resolved inheritAttrs options
     * @internal
     */
    inheritAttrs?: boolean

    // the rest are only for stateful components ---------------------------------

    // main proxy that serves as the public instance (`this`)
    proxy: ComponentPublicInstance | null

    // exposed properties via expose()
    exposed: Record<string, any> | null
    exposeProxy: Record<string, any> | null

    // 实例代理的目标对象，保留用户通过 this 添加的属性
    ctx: Data

    // state
    props: Data
    attrs: Data
    slots: InternalSlots
    refs: Data
    emit: EmitFn

    /**
     * used for keeping track of .once event handlers on components
     * @internal
     */
    emitted: Record<string, boolean> | null
    /**
     * used for caching the value returned from props default factory functions to
     * avoid unnecessary watcher trigger
     * @internal
     */
    propsDefaults: Data
    /**
     * setup related
     * @internal
     */
    setupState: Data
    /**
     * devtools access to additional info
     * @internal
     */
    devtoolsRawSetupState?: any
    /**
     * @internal
     */
    setupContext: SetupContext | null

    /**
     * suspense related
     * @internal
     */
    suspense: SuspenseBoundary | null
    /**
     * suspense pending batch id
     * @internal
     */
    suspenseId: number
    /**
     * @internal
     */
    asyncDep: Promise<any> | null
    /**
     * @internal
     */
    asyncResolved: boolean

    // lifecycle
    isMounted: boolean
    isUnmounted: boolean
    isDeactivated: boolean
    /**
     * @internal
     */
    [LifecycleHooks.BEFORE_CREATE]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.CREATED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.BEFORE_MOUNT]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.MOUNTED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.BEFORE_UPDATE]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.UPDATED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.BEFORE_UNMOUNT]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.UNMOUNTED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.RENDER_TRACKED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.RENDER_TRIGGERED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.ACTIVATED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.DEACTIVATED]: LifecycleHook
    /**
     * @internal
     */
    [LifecycleHooks.ERROR_CAPTURED]: LifecycleHook
    /**
     * @internal
     */

    /**
     * For caching bound $forceUpdate on public proxy access
     * @internal
     */
    f?: () => void
    /**
     * For caching bound $nextTick on public proxy access
     * @internal
     */
    n?: () => Promise<void>


}

const emptyAppContext = createAppContext()

let uid = 0

export function createComponentInstance(
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null,
): ComponentInternalInstance {
    const type = vnode.type as ConcreteComponent
    // inherit parent app context - or - if root, adopt from root vnode
    const appContext =
        (parent ? parent.appContext : vnode.appContext) || emptyAppContext

    const instance: ComponentInternalInstance = {
        uid: uid++,
        vnode,
        type,
        parent,
        appContext,
        root: null!, // to be immediately set
        next: null,
        subTree: null!, // will be set synchronously right after creation
        effect: null!,
        update: null!, // will be set synchronously right after creation
        job: null!,
        scope: new EffectScope(true /* detached */),
        render: null,
        proxy: null,
        exposed: null,
        exposeProxy: null,
        provides: parent ? parent.provides : Object.create(appContext.provides),
        ids: parent ? parent.ids : ['', 0, 0],
        accessCache: null!,
        renderCache: [],
        // local resolved assets
        // resolved props and emits options
        propsOptions: normalizePropsOptions(type, appContext),
        emitsOptions: normalizeEmitsOptions(type, appContext),
        // emit
        emit: null!, // to be set immediately
        emitted: null,
        // props default value
        propsDefaults: EMPTY_OBJ,
        // inheritAttrs
        inheritAttrs: type.inheritAttrs,
        // state
        ctx: EMPTY_OBJ,
        props: EMPTY_OBJ,
        attrs: EMPTY_OBJ,
        slots: EMPTY_OBJ,
        refs: EMPTY_OBJ,
        setupState: EMPTY_OBJ,
        setupContext: null,
        // suspense related
        suspense,
        suspenseId: suspense ? suspense.pendingId : 0,
        asyncDep: null,
        asyncResolved: false,
        // lifecycle hooks
        // not using enums here because it results in computed properties
        isMounted: false,
        isUnmounted: false,
        isDeactivated: false,
        bc: null,
        c: null,
        bm: null,
        m: null,
        bu: null,
        u: null,
        um: null,
        bum: null,
        da: null,
        a: null,
        rtg: null,
        rtc: null,
        ec: null,
    }
    if (__DEV__) {
        instance.ctx = createDevRenderContext(instance)
    } else {
        instance.ctx = { _: instance }
    }
    instance.root = parent ? parent.root : instance
    instance.emit = emit.bind(null, instance)

    return instance
}

export let currentInstance: ComponentInternalInstance | null = null

export const getCurrentInstance: () => ComponentInternalInstance | null = () =>
    currentInstance || currentRenderingInstance

const internalSetCurrentInstance = (instance: ComponentInternalInstance | null) => { currentInstance = instance }

export const setCurrentInstance = (instance: ComponentInternalInstance) => {
    const prev = currentInstance
    internalSetCurrentInstance(instance)
    instance.scope.on()
    return (): void => {
        instance.scope.off()
        internalSetCurrentInstance(prev)
    }
}

export const unsetCurrentInstance = (): void => {
    currentInstance && currentInstance.scope.off()
    internalSetCurrentInstance(null)
}

const isBuiltInTag = /*@__PURE__*/ makeMap('slot,component')

export function validateComponentName(
    name: string,
    { isNativeTag }: AppConfig,
): void {
    if (isBuiltInTag(name) || isNativeTag(name)) {
        warn(
            'Do not use built-in or reserved HTML elements as component id: ' + name,
        )
    }
}

export function isStatefulComponent(
    instance: ComponentInternalInstance,
): number {
    return instance.vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
}

export function setupComponent(
    instance: ComponentInternalInstance,
    optimized = false,
): void {

    const { props, children } = instance.vnode
    const isStateful = isStatefulComponent(instance)
    initProps(instance, props, isStateful)
    initSlots(instance, children, optimized)

    const setupResult = isStateful
        ? setupStatefulComponent(instance)
        : undefined

    return setupResult
}

function setupStatefulComponent(
    instance: ComponentInternalInstance,
) {
    const Component = instance.type as ComponentOptions
    validateComponentOptions(Component)

    if (__DEV__) {
        if (Component.name) {
            validateComponentName(Component.name, instance.appContext.config)
        }
        if (Component.components) {
            const names = Object.keys(Component.components)
            for (let i = 0; i < names.length; i++) {
                validateComponentName(names[i], instance.appContext.config)
            }
        }
        if (Component.directives) {
            const names = Object.keys(Component.directives)
            for (let i = 0; i < names.length; i++) {
                validateDirectiveName(names[i])
            }
        }
    }
    // 0. create render proxy property access cache
    instance.accessCache = Object.create(null)
    // 1. create public instance / render proxy
    instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
    if (__DEV__) {
        exposePropsOnRenderContext(instance)
    }
    // 2. call setup()
    const { setup } = Component
    if (setup) {
        pauseTracking()
        const setupContext = (instance.setupContext =
            setup.length > 1 ? createSetupContext(instance) : null)
        const reset = setCurrentInstance(instance)
        const setupResult = callWithErrorHandling(
            setup,
            instance,
            ErrorCodes.SETUP_FUNCTION,
            [
                __DEV__ ? shallowReadonly(instance.props) : instance.props,
                setupContext,
            ],
        )
        const isAsyncSetup = isPromise(setupResult)
        resetTracking()
        reset()

        if ((isAsyncSetup) && !isAsyncWrapper(instance)) {
            // 异步 setup 为 useId 建立独立边界
            markAsyncBoundary(instance)
        }

        if (isAsyncSetup) {
            setupResult.then(unsetCurrentInstance, unsetCurrentInstance)
            {
                // async setup returned Promise.
                // bail here and wait for re-entry.
                instance.asyncDep = setupResult
                if (__DEV__ && !instance.suspense) {
                    const name = formatComponentName(instance, Component)
                    warn(
                        `Component <${name}>: setup function returned a promise, but no ` +
                        `<Suspense> boundary was found in the parent component tree. ` +
                        `A component with async setup() must be nested in a <Suspense> ` +
                        `in order to be rendered.`,
                    )
                }
            }
        } else {
            handleSetupResult(instance, setupResult)
        }
    } else {
        finishComponentSetup(instance)
    }
}

export function handleSetupResult(
    instance: ComponentInternalInstance,
    setupResult: unknown,
): void {
    if (isFunction(setupResult)) {
        // setup returned an inline render function
        {
            instance.render = setupResult as InternalRenderFunction
        }
    } else if (isObject(setupResult)) {
        if (__DEV__ && isVNode(setupResult)) {
            warn(
                `setup() should not return VNodes directly - ` +
                `return a render function instead.`,
            )
        }
        // setup returned bindings.
        // assuming a render function compiled from template is present.
        if ((__DEV__)) {
            instance.devtoolsRawSetupState = setupResult
        }
        instance.setupState = proxyRefs(setupResult)
        if (__DEV__) {
            exposeSetupStateOnRenderContext(instance)
        }
    } else if (__DEV__ && setupResult !== undefined) {
        warn(
            `setup() should return an object. Received: ${setupResult === null ? 'null' : typeof setupResult
            }`,
        )
    }
    finishComponentSetup(instance)
}

export function finishComponentSetup(instance: ComponentInternalInstance): void {
    const component = instance.type as ComponentOptions
    if (!instance.render) instance.render = (component.render || NOOP) as InternalRenderFunction
}

const attrsProxyHandlers = __DEV__
    ? {
        get(target: Data, key: string) {
            markAttrsAccessed()
            return target[key]
        },
        set() {
            warn(`setupContext.attrs is readonly.`)
            return false
        },
        deleteProperty() {
            warn(`setupContext.attrs is readonly.`)
            return false
        },
    }
    : {
        get(target: Data, key: string) {
            return target[key]
        },
    }

/**
 * Dev-only
 */
function getSlotsProxy(instance: ComponentInternalInstance): Slots {
    return new Proxy(instance.slots, {
        get(target, key: string) {
            track(instance, TrackOpTypes.GET, '$slots')
            return target[key]
        },
    })
}

export function createSetupContext(
    instance: ComponentInternalInstance,
): SetupContext {
    const expose: SetupContext['expose'] = exposed => {
        if (__DEV__) {
            if (instance.exposed) {
                warn(`expose() should be called only once per setup().`)
            }
            if (exposed != null) {
                let exposedType: string = typeof exposed
                if (exposedType === 'object') {
                    if (isArray(exposed)) {
                        exposedType = 'array'
                    } else if (isRef(exposed)) {
                        exposedType = 'ref'
                    }
                }
                if (exposedType !== 'object') {
                    warn(
                        `expose() should be passed a plain object, received ${exposedType}.`,
                    )
                }
            }
        }
        instance.exposed = exposed || {}
    }

    if (__DEV__) {
        // We use getters in dev in case libs like test-utils overwrite instance
        // properties (overwrites should not be done in prod)
        let attrsProxy: Attrs
        let slotsProxy: Slots
        return Object.freeze({
            get attrs() {
                return (
                    attrsProxy ||
                    (attrsProxy = new Proxy(instance.attrs, attrsProxyHandlers) as Attrs)
                )
            },
            get slots() {
                return slotsProxy || (slotsProxy = getSlotsProxy(instance))
            },
            get emit() {
                return (event: string, ...args: any[]) => instance.emit(event, ...args)
            },
            expose,
        })
    } else {
        return {
            attrs: new Proxy(instance.attrs, attrsProxyHandlers) as Attrs,
            slots: instance.slots,
            emit: instance.emit,
            expose,
        }
    }
}

export function getComponentPublicInstance(
    instance: ComponentInternalInstance,
): ComponentPublicInstance | ComponentInternalInstance['exposed'] | null {
    if (instance.exposed) {
        return (
            instance.exposeProxy ||
            (instance.exposeProxy = new Proxy(proxyRefs(markRaw(instance.exposed)), {
                get(target, key: string) {
                    if (key in target) {
                        return target[key]
                    } else if (key in publicPropertiesMap) {
                        return publicPropertiesMap[key](instance)
                    }
                },
                has(target, key: string) {
                    return key in target || key in publicPropertiesMap
                },
            }))
        )
    } else {
        return instance.proxy
    }
}

const classifyRE = /(?:^|[-_])\w/g
const classify = (str: string): string =>
    str.replace(classifyRE, c => c.toUpperCase()).replace(/[-_]/g, '')

export function getComponentName(
    Component: ConcreteComponent,
    includeInferred = true,
): string | false | undefined {
    return isFunction(Component)
        ? Component.displayName || Component.name
        : Component.name || (includeInferred && Component.__name)
}

export function formatComponentName(
    instance: ComponentInternalInstance | null,
    Component: ConcreteComponent,
    isRoot = false,
): string {
    let name = getComponentName(Component)
    if (!name && Component.__file) {
        const match = Component.__file.match(/([^/\\]+)\.\w+$/)
        if (match) {
            name = match[1]
        }
    }

    if (!name && instance) {
        // try to infer the name based on reverse resolution
        const inferFromRegistry = (
            registry: Record<string, any> | undefined | null,
        ) => {
            for (const key in registry) {
                if (registry[key] === Component) {
                    return key
                }
            }
        }
        name =
            (instance.parent &&
                inferFromRegistry(
                    (instance.parent.type as ComponentOptions).components,
                )) ||
            inferFromRegistry(instance.appContext.components)
    }

    return name ? classify(name) : isRoot ? `App` : `Anonymous`
}

export function isClassComponent(value: unknown): value is ClassComponent {
    return isFunction(value) && '__vccOpts' in value
}
