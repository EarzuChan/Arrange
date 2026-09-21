import type { AppConfig, AppContext, ArrangableDefinition, Data } from './runtime/internal.ts'
import { RearrangeSession } from './runtime/internal.ts'
import { isArrangableDefinition } from './runtime/internal.ts'
import { NativeRearrangeHost } from './rearrangeNode.ts'
import { Layout } from './arrangable/Layout.ts'
import { Box, Row, Column, Spacer } from './arrangable/LayoutingArrangables.ts'
import { Text, Input } from './arrangable/TextAndInput.ts'
import { Image, Icon } from './arrangable/ImageAndIcon.ts'
import { DynamicArrangable } from './arrangable/ToolArrangables.ts'
import { ARRANGE_RUNTIME_VERSION, type NativeTransactionTarget } from './native.ts'
import { createDensity, DensityKey } from './density.ts'

declare global {
    var __ARRANGE_NATIVE__: NativeTransactionTarget | undefined
}

export interface ArrangeApp {
    readonly config: AppConfig

    arrangable(name: string, definition: ArrangableDefinition): ArrangeApp

    provide<T>(key: PropertyKey, value: T): ArrangeApp

    mount(target?: NativeTransactionTarget): void

    unmount(): void
}

const foundationArrangables = { Layout, Box, Row, Column, Spacer, Text, Input, Image, Icon, DynamicArrangable }

const mountedTargets = new WeakSet<NativeTransactionTarget>()

export function createApp(root: ArrangableDefinition, props: Data = {}): ArrangeApp {
    if (!isArrangableDefinition(root)) throw new TypeError('App 根必须是 Arrangable 定义')

    const config: AppConfig = {}
    const definitions = { ...foundationArrangables } as Record<string, ArrangableDefinition>
    const provides = Object.create(null)
    provides[DensityKey] = createDensity()
    let rearrangeSession: RearrangeSession | undefined
    let native: NativeTransactionTarget | undefined

    const app: ArrangeApp = {
        config,
        arrangable(name, definition) {
            if (!isArrangableDefinition(definition)) throw new TypeError('注册目标必须是 Arrangable 定义')
            definitions[name] = definition
            return app
        },
        provide(key, value) {
            provides[key] = value
            return app
        },
        mount(target = globalThis.__ARRANGE_NATIVE__) {
            if (rearrangeSession) throw new Error('App 已经挂载')

            if (!target) throw new Error('Arrange 缺少原生运行时')

            if (mountedTargets.has(target)) throw new Error('原生宿主已由另一个 App 占用')

            if (target.runtimeVersion !== undefined && target.runtimeVersion !== ARRANGE_RUNTIME_VERSION) throw new Error('Arrange 脚本与原生协议版本不一致')

            for (const name of ['installFrameDriver', 'currentTime', 'requestFrame', 'beginRearrange', 'submitRearrange', 'abortRearrange', 'createNode', 'deleteNode', 'insertChild', 'removeChild', 'registerBinding', 'updateBinding', 'releaseBinding', 'modifierInstances', 'registerModifierBinding', 'unmount'] as const) if (typeof target[name] !== 'function') throw new TypeError(`原生运行时缺少正式入口：${name}`)

            native = target
            mountedTargets.add(target)

            const context: AppContext = { config, definitions, provides, host: new NativeRearrangeHost(target) }

            rearrangeSession = new RearrangeSession(context, root, Object.fromEntries(Object.entries(props).map(([name, value]) => [name, () => value])))

            try {
                target.installFrameDriver(rearrangeSession.scheduler.prepare, rearrangeSession.scheduler.complete, () => app.unmount())
                rearrangeSession.mount()
            } catch (error) {
                try {
                    rearrangeSession.dispose()
                } finally {
                    mountedTargets.delete(target)
                    rearrangeSession = undefined
                    native = undefined
                }
                throw error
            }
        },
        unmount() {
            const target = native

            try {
                rearrangeSession?.dispose()
            } finally {
                rearrangeSession = undefined
                native = undefined

                if (target) try {
                    target.unmount()
                } finally {
                    mountedTargets.delete(target)
                }
            }
        }
    }

    return app
}
