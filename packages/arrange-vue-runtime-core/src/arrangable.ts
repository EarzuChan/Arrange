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
import { type ArrangableOptions, validateArrangableOptions } from './arrangableOptions.ts'
import { isFoundationArrangable } from './apiDefineFoundationArrangable.ts'
import { initializeFoundation } from './foundationExecution.ts'
import {
    type ArrangablePropsOptions,
    type NormalizedPropsOptions,
    initProps,
    normalizePropsOptions,
} from './arrangableProps.ts'
import {
    type ArrangablePublicInstance,
    type ArrangablePublicInstanceConstructor,
    PublicInstanceProxyHandlers,
    createDevRenderContext,
    exposePropsOnRenderContext,
    exposeSetupStateOnRenderContext,
    publicPropertiesMap,
} from './arrangablePublicInstance.ts'
import { currentRenderingInstance } from './arrangableRenderContext.ts'
import {
    type InternalSlots,
    type Slots,
    type SlotsType,
    type UnwrapSlotsType,
    initSlots,
} from './arrangableSlots.ts'
import type { LifecycleHooks } from './enums.ts'
import { ErrorCodes, callWithErrorHandling, handleError } from './errorHandling.ts'

import type { SchedulerJob } from './scheduler.ts'
import { type VNode, type VNodeChild, isVNode } from './vnode.ts'
import { warn } from './warning.ts'

// Augment GlobalArrangables
import type { DefineArrangable } from './apiDefineArrangable.ts'
import type { RendererElement } from './renderer.ts'

export type Data = Record<string, unknown>

/**
 * For globally defined Arrangables
 * Here is an example of adding a arrangable `RouterView` as global arrangable:
 *
 * @example
 * ```ts
 *
import { RouterView } from 'vue-router'
 *
 * declare module '@arrange/vue-runtime-core' {
 *   interface GlobalArrangables {
 *     RouterView
 *   }
 * }
 * ```
 */
export interface GlobalArrangables {
}


// Note: can't mark this whole interface internal because some public interfaces
// extend it.
export interface ArrangableInternalOptions {
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

export interface FunctionalArrangable<
    P = {},
    S extends Record<string, any> = any,
> extends ArrangableInternalOptions {
    // use of any here is intentional so it can be a valid JSX Element constructor
    (
        props: P,
        ctx: SetupContext<IfAny<S, {}, SlotsType<S>>>,
    ): any
    props?: ArrangablePropsOptions<P>
    slots?: IfAny<S, Slots, SlotsType<S>>
    slotNames?: readonly string[]
    displayName?: string
}

export interface ClassArrangable {
    new(...args: any[]): ArrangablePublicInstance<any, any>
    __vccOpts: ArrangableOptions
}

/**
 * Concrete arrangable type matches its actual value: it's either an options
 * object, or a function. Use this where the code expects to work with actual
 * values, e.g. checking if its a function or not. This is mostly for internal
 * implementation code.
 */
export type ConcreteArrangable<
    Props = {},
    RawBindings = any,
    S extends Record<string, any> = any,
> =
    | ArrangableOptions<Props, RawBindings>
    | FunctionalArrangable<Props, S>

/**
 * A type used in public APIs where a arrangable type is expected.
 * The constructor type is an artificial type returned by defineArrangable().
 */
export type Arrangable<
    PropsOrInstance = any,
    RawBindings = any,
    S extends Record<string, any> = any,
> =
    | ConcreteArrangable<PropsOrInstance, RawBindings, S>
    | ArrangablePublicInstanceConstructor<PropsOrInstance>

export type { ArrangableOptions }

export type LifecycleHook<TFn = Function> = (TFn & SchedulerJob)[] | null

export type SetupContext<S extends SlotsType = {}> = { readonly slots: UnwrapSlotsType<S> }

/**
 * @internal
 */
export type InternalRenderFunction = {
    (
        ctx: ArrangablePublicInstance,
        cache: ArrangableInstance['renderCache'],
        // for compiler-optimized bindings
        $props: ArrangableInstance['props'],
        $setup: ArrangableInstance['setupState'],
    ): VNodeChild
}

/**
 * We expose a subset of properties on the internal instance as they are
 * useful for advanced external libraries and tools.
 */
export interface ArrangableInstance {
    uid: number
    type: ConcreteArrangable
    parent: ArrangableInstance | null
    root: ArrangableInstance
    appContext: AppContext
    /**
     * Vnode representing this arrangable in its parent's vdom tree
     */
    vnode: VNode
    /**
     * The pending new vnode from parent updates
     * @internal
     */
    next: VNode | null
    /**
     * Root vnode of this arrangable's own vdom tree
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
     * Object containing values this arrangable provides for its descendants
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
     * Tracking reactive effects (e.g. watchers) associated with this arrangable
     * so that they can be automatically stopped on arrangable unmount
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
    // the rest are only for stateful arrangables ---------------------------------

    // main proxy that serves as the public instance (`this`)
    proxy: ArrangablePublicInstance | null


    // 实例代理的目标对象，保留用户通过 this 添加的属性
    ctx: Data

    // state
    props: Data
    slots: InternalSlots

    /**
     * used for keeping track of .once event handlers on arrangables
     * @internal
     */
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

export function createArrangableInstance(
    vnode: VNode,
    parent: ArrangableInstance | null,
    
): ArrangableInstance {
    const type = vnode.type as ConcreteArrangable
    // inherit parent app context - or - if root, adopt from root vnode
    const appContext =
        (parent ? parent.appContext : vnode.appContext) || emptyAppContext

    const instance: ArrangableInstance = {
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
        provides: parent ? parent.provides : Object.create(appContext.provides),
        ids: parent ? parent.ids : ['', 0, 0],
        accessCache: null!,
        renderCache: [],
        // local resolved assets
        // 正式参数声明
        propsOptions: normalizePropsOptions(type, appContext),
        // props default value
        propsDefaults: EMPTY_OBJ,
        // state
        ctx: EMPTY_OBJ,
        props: EMPTY_OBJ,
        slots: EMPTY_OBJ,
        setupState: EMPTY_OBJ,
        setupContext: null,
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

    return instance
}

export let currentInstance: ArrangableInstance | null = null

export const getCurrentInstance: () => ArrangableInstance | null = () =>
    currentInstance || currentRenderingInstance

const internalSetCurrentInstance = (instance: ArrangableInstance | null) => { currentInstance = instance }

export const setCurrentInstance = (instance: ArrangableInstance) => {
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

const isBuiltInTag = /*@__PURE__*/ makeMap('slot,arrangable')

export function validateArrangableName(
    name: string,
    { isNativeTag }: AppConfig,
): void {
    if (isBuiltInTag(name) || isNativeTag(name)) {
        warn(
            'Do not use built-in or reserved HTML elements as arrangable id: ' + name,
        )
    }
}

export function isStatefulArrangable(
    instance: ArrangableInstance,
): number {
    return instance.vnode.shapeFlag & ShapeFlags.STATEFUL_ARRANGABLE
}

export function setupArrangable(
    instance: ArrangableInstance,
    optimized = false,
): void {

    const { props, children } = instance.vnode
    const isStateful = isStatefulArrangable(instance)
    initProps(instance, props, isStateful)
    initSlots(instance, children, optimized)

    const setupResult = isStateful
        ? setupStatefulArrangable(instance)
        : undefined

    return setupResult
}

function setupStatefulArrangable(
    instance: ArrangableInstance,
) {
    const Arrangable = instance.type as ArrangableOptions
    validateArrangableOptions(Arrangable)

    if (__DEV__) {
        if (Arrangable.name) {
            validateArrangableName(Arrangable.name, instance.appContext.config)
        }
        if (Arrangable.arrangables) {
            const names = Object.keys(Arrangable.arrangables)
            for (let i = 0; i < names.length; i++) {
                validateArrangableName(names[i], instance.appContext.config)
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
    // FA 使用独立实现入口，状态初始化只发生于实例创建
    if (isFoundationArrangable(Arrangable)) {
        pauseTracking()
        const reset = setCurrentInstance(instance)
        try {
            initializeFoundation(instance)
        } catch (error) {
            handleError(error, instance, ErrorCodes.SETUP_FUNCTION)
            throw error
        } finally {
            resetTracking()
            reset()
        }
        return
    }

    // SFA 保留脚本初始化与模板执行的边界
    const { setup } = Arrangable
    if (setup) {
        pauseTracking()
        const setupContext = (instance.setupContext =
            setup.length > 1 ? createSetupContext(instance) : null)
        const reset = setCurrentInstance(instance)
        let setupResult
        try {
            setupResult = setup(shallowReadonly(instance.props), setupContext as SetupContext)
        } catch (error) {
            handleError(error, instance, ErrorCodes.SETUP_FUNCTION)
            throw error
        } finally {
            resetTracking()
            reset()
        }
        if (isPromise(setupResult)) {
            setupResult.catch(() => {})
            throw new TypeError('Arrangable 初始化必须同步；异步加载请通过明确状态与控制流表达')
        }
        handleSetupResult(instance, setupResult)
    } else {
        finishArrangableSetup(instance)
    }
}

export function handleSetupResult(
    instance: ArrangableInstance,
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
    finishArrangableSetup(instance)
}

export function finishArrangableSetup(instance: ArrangableInstance): void {
    const arrangable = instance.type as ArrangableOptions
    if (!instance.render) instance.render = (arrangable.render || NOOP) as InternalRenderFunction
}

export function createSetupContext(instance: ArrangableInstance): SetupContext {
    return Object.freeze({ slots: shallowReadonly(instance.slots) })
}

export function getArrangablePublicInstance(instance: ArrangableInstance): ArrangablePublicInstance | null {
    return instance.proxy
}

const classifyRE = /(?:^|[-_])\w/g
const classify = (str: string): string =>
    str.replace(classifyRE, c => c.toUpperCase()).replace(/[-_]/g, '')

export function getArrangableName(
    Arrangable: ConcreteArrangable,
    includeInferred = true,
): string | false | undefined {
    return isFunction(Arrangable)
        ? Arrangable.displayName || Arrangable.name
        : Arrangable.name || (includeInferred && Arrangable.__name)
}

export function formatArrangableName(
    instance: ArrangableInstance | null,
    Arrangable: ConcreteArrangable,
    isRoot = false,
): string {
    let name = getArrangableName(Arrangable)
    if (!name && Arrangable.__file) {
        const match = Arrangable.__file.match(/([^/\\]+)\.\w+$/)
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
                if (registry[key] === Arrangable) {
                    return key
                }
            }
        }
        name =
            (instance.parent &&
                inferFromRegistry(
                    (instance.parent.type as ArrangableOptions).arrangables,
                )) ||
            inferFromRegistry(instance.appContext.arrangables)
    }

    return name ? classify(name) : isRoot ? `App` : `Anonymous`
}

export function isClassArrangable(value: unknown): value is ClassArrangable {
    return isFunction(value) && '__vccOpts' in value
}
