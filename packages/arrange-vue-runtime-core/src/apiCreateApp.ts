import { NO, extend, hasOwn, isFunction, isObject } from '@arrange/vue-shared'
import type { DefineArrangable } from './apiDefineArrangable.ts'
import type { InjectionKey } from './apiInject.ts'
import {
    type Arrangable,
    type ArrangableInstance,
    type ConcreteArrangable,
    type Data,
    getArrangablePublicInstance,
    validateArrangableName,
} from './arrangable.ts'
import type { NormalizedPropsOptions } from './arrangableProps.ts'
import type {
    ArrangableCustomProperties,
    ArrangablePublicInstance,
} from './arrangablePublicInstance.ts'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling.ts'
import { version } from './index.ts'
import type { RootRenderFunction } from './renderer.ts'
import { type VNode, cloneVNode, createVNode } from './vnode.ts'
import { warn } from './warning.ts'

export interface App<HostElement = any> {
    version: string
    config: AppConfig

    use<Options extends unknown[]>(
        plugin: Plugin<Options>,
        ...options: NoInfer<Options>
    ): this
    use<Options>(plugin: Plugin<Options>, options: NoInfer<Options>): this

    arrangable(name: string): Arrangable | undefined
    arrangable<T extends Arrangable | DefineArrangable>(
        name: string,
        arrangable: T,
    ): this
    mount(
        rootContainer: HostElement | string,
        /**
         * @internal
         */

        /**
         * @internal
         */
        vnode?: VNode,
    ): ArrangablePublicInstance
    unmount(): void
    onUnmount(cb: () => void): void
    provide<T, K = InjectionKey<T> | string | number>(
        key: K,
        value: K extends InjectionKey<infer V> ? V : T,
    ): this

    /**
     * Runs a function with the app as active instance. This allows using of `inject()` within the function to get access
     * to variables provided via `app.provide()`.
     *
     * @param fn - function to run with the app as active instance
     */
    runWithContext<T>(fn: () => T): T

    _uid: number
    _arrangable: ConcreteArrangable
    _props: Data | null
    _container: HostElement | null
    _context: AppContext
    _instance: ArrangableInstance | null

}

export interface AppConfig {
    // @private
    readonly isNativeTag: (tag: string) => boolean

    globalProperties: ArrangableCustomProperties & Record<string, any>
    errorHandler?: (
        err: unknown,
        instance: ArrangablePublicInstance | null,
        info: string,
    ) => void
    warnHandler?: (
        msg: string,
        instance: ArrangablePublicInstance | null,
        trace: string,
    ) => void



    /**
     * TODO document for 3.5
     * Enable warnings for computed getters that recursively trigger itself.
     */
    warnRecursiveComputed?: boolean

    throwUnhandledErrorInProduction?: boolean

    /**
     * Prefix for all useId() calls within this app
     */
    idPrefix?: string
}

export interface AppContext {
    app: App // for devtools
    config: AppConfig
    arrangables: Record<string, Arrangable>
    provides: Record<string | symbol, any>

    /**
     * Cache for normalized props options
     * @internal
     */
    propsCache: WeakMap<ConcreteArrangable, NormalizedPropsOptions>
    /**
     * Cache for normalized emits options
     * @internal
     */
    /**
     * HMR only
     * @internal
     */
    reload?: () => void
}

type PluginInstallFunction<Options = any[]> = Options extends unknown[]
    ? (app: App, ...options: Options) => any
    : (app: App, options: Options) => any

export type ObjectPlugin<Options = any[]> = {
    install: PluginInstallFunction<Options>
}
export type FunctionPlugin<Options = any[]> = PluginInstallFunction<Options> &
    Partial<ObjectPlugin<Options>>

export type Plugin<
    Options = any[],
    // TODO: in next major Options extends unknown[] and remove P
    P extends unknown[] = Options extends unknown[] ? Options : [Options],
> = FunctionPlugin<P> | ObjectPlugin<P>

export function createAppContext(): AppContext {
    return {
        app: null as any,
        config: {
            isNativeTag: NO,
            globalProperties: {},
            errorHandler: undefined,
            warnHandler: undefined,
        },
        arrangables: {},
        provides: Object.create(null),
        propsCache: new WeakMap(),
    }
}

export type CreateAppFunction<HostElement> = (
    rootArrangable: Arrangable,
    rootProps?: Data | null,
) => App<HostElement>

let uid = 0

export function createAppAPI<HostElement>(
    render: RootRenderFunction<HostElement>,
): CreateAppFunction<HostElement> {
    return function createApp(rootArrangable, rootProps = null) {

        if (rootProps != null && !isObject(rootProps)) {
            __DEV__ && warn(`root props passed to app.mount() must be an object.`)
            rootProps = null
        }

        const context = createAppContext()
        const installedPlugins = new WeakSet()
        const pluginCleanupFns: Array<() => any> = []

        let isMounted = false

        const app: App = (context.app = {
            _uid: uid++,
            _arrangable: rootArrangable as ConcreteArrangable,
            _props: rootProps,
            _container: null,
            _context: context,
            _instance: null,
            version,
            get config() {
                return context.config
            },
            set config(v) {
                if (__DEV__) {
                    warn(
                        `app.config cannot be replaced. Modify individual options instead.`,
                    )
                }
            },
            use(plugin: Plugin, ...options: any[]) {
                if (installedPlugins.has(plugin)) {
                    __DEV__ && warn(`Plugin has already been applied to target app.`)
                } else if (plugin && isFunction(plugin.install)) {
                    installedPlugins.add(plugin)
                    plugin.install(app, ...options)
                } else if (isFunction(plugin)) {
                    installedPlugins.add(plugin)
                    plugin(app, ...options)
                } else if (__DEV__) {
                    warn(
                        `A plugin must either be a function or an object with an "install" ` +
                        `function.`,
                    )
                }
                return app
            },
            arrangable(name: string, arrangable?: Arrangable): any {
                if (__DEV__) {
                    validateArrangableName(name, context.config)
                }
                if (!arrangable) {
                    return context.arrangables[name]
                }
                if (__DEV__ && context.arrangables[name]) {
                    warn(`Arrangable "${name}" has already been registered in target app.`)
                }
                context.arrangables[name] = arrangable
                return app
            },
            mount(
                rootContainer: HostElement,
            ): any {
                if (!isMounted) {
                    // #5571
                    if (__DEV__ && (rootContainer as any).__vue_app__) {
                        warn(
                            `There is already an app instance mounted on the host container.\n` +
                            ` If you want to mount another app on the same host container,` +
                            ` you need to unmount the previous app by calling \`app.unmount()\` first.`,
                        )
                    }
                    const vnode = createVNode(rootArrangable, rootProps)
                    // store app context on the root VNode.
                    // this will be set on the root instance on initial mount.
                    vnode.appContext = context

                    // 逻辑树重载
                    if (__DEV__) {
                        context.reload = () => {
                            const cloned = cloneVNode(vnode)

                            cloned.el = null
                            // casting to ElementNamespace because TS doesn't guarantee type narrowing
                            // over function boundaries
                            render(cloned, rootContainer)
                        }
                    }

                    render(vnode, rootContainer)
                    isMounted = true
                    app._container = rootContainer

                        ; (rootContainer as any).__vue_app__ = app

                    if ((__DEV__)) {
                        app._instance = vnode.arrangable

                    }

                    return getArrangablePublicInstance(vnode.arrangable!)
                } else if (__DEV__) {
                    warn(
                        `App has already been mounted.\n` +
                        `If you want to remount the same app, move your app creation logic ` +
                        `into a factory function and create fresh app instances for each ` +
                        `mount - e.g. \`const createMyApp = () => createApp(App)\``,
                    )
                }
            },
            onUnmount(cleanupFn: () => void) {
                if (__DEV__ && typeof cleanupFn !== 'function') {
                    warn(
                        `Expected function as first argument to app.onUnmount(), ` +
                        `but got ${typeof cleanupFn}`,
                    )
                }
                pluginCleanupFns.push(cleanupFn)
            },
            unmount() {
                if (isMounted) {
                    callWithAsyncErrorHandling(
                        pluginCleanupFns,
                        app._instance,
                        ErrorCodes.APP_UNMOUNT_CLEANUP,
                    )
                    render(null, app._container)
                    if ((__DEV__)) {
                        app._instance = null

                    }
                    delete app._container.__vue_app__
                } else if (__DEV__) {
                    warn(`Cannot unmount an app that is not mounted.`)
                }
            },
            provide(key, value) {
                if (__DEV__ && (key as string | symbol) in context.provides) {
                    if (hasOwn(context.provides, key as string | symbol)) {
                        warn(
                            `App already provides property with key "${String(key)}". ` +
                            `It will be overwritten with the new value.`,
                        )
                    } else {

                        warn(
                            `App already provides property with key "${String(key)}" inherited from its parent element. ` +
                            `It will be overwritten with the new value.`,
                        )
                    }
                }

                context.provides[key as string | symbol] = value

                return app
            },
            runWithContext(fn) {
                const lastApp = currentApp
                currentApp = app
                try {
                    return fn()
                } finally {
                    currentApp = lastApp
                }
            },
        })

        return app
    }
}

/**
 * @internal Used to identify the current app when using `inject()` within
 * `app.runWithContext()`.
 */
export let currentApp: App<unknown> | null = null
