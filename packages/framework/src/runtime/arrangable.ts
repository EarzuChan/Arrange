import { effectScope, type EffectScope } from '@arrange/reactivity'
import type { ArrangableObjectPropsOptions, ExtractPublicPropTypes, PropInputs, PropStore } from './arrangableProps.ts'
import type { RearrangeHost, RearrangeNode } from './rearrangeNode.ts'
import type { RearrangeSession, RearrangeScope } from './rearrange.ts'
import type { LifecycleHooks } from './enums.ts'
import type { ParameterPlan } from './propDeclarations.ts'

export type Data = Record<string, unknown>
export type StructureProgram = () => void
export type Content = () => void
export type Contents = Readonly<Record<string, Content | undefined>>
export type CallPosition = string | number
export type RearrangeKey = string | number | symbol | bigint | null | undefined

export interface ArrangableDefinition<P extends Data = any> {
    readonly name?: string
    readonly __name?: string
    readonly __file?: string
    readonly __hmrId?: string
    readonly props: ArrangableObjectPropsOptions<P>
    readonly slotNames: readonly string[]
    readonly contentTarget?: string
    readonly setup: (props: Readonly<P>, context: SetupContext) => StructureProgram
}

export type Arrangable<P extends Data = any> = ArrangableDefinition<P>
export type ArrangableProps<D extends ArrangableDefinition> = string extends keyof D['props'] ? Data : ExtractPublicPropTypes<D['props']>

export interface CallMetadata {
    readonly parameters?: ParameterPlan
    readonly key?: RearrangeKey
    readonly source?: string
    readonly sources?: Readonly<Record<string, string | undefined>>
    readonly constants?: readonly string[]
}

export interface SetupContext {
    readonly slots: Readonly<Record<string, Content>>
    readonly call: <D extends ArrangableDefinition>(position: CallPosition, definition: D, inputs: PropInputs<ArrangableProps<D>>, contents?: Contents, metadata?: CallMetadata) => void
    readonly slot: (name?: string) => Content
    readonly source: (name: string) => string | undefined
}

export interface AppConfig {
    errorHandler?: (error: unknown, source: string | undefined, phase: string) => void
    warnHandler?: (message: string) => void
    warnRecursiveComputed?: boolean
    throwUnhandledErrorInProduction?: boolean
}

export interface AppContext {
    readonly config: AppConfig
    readonly provides: Record<PropertyKey, unknown>
    readonly definitions: Record<string, ArrangableDefinition>
    readonly host: RearrangeHost
}

export class ArrangableInstance {
    readonly uid = nextInstanceId++
    readonly scope: EffectScope = effectScope(true)
    readonly provides: Record<PropertyKey, unknown>
    readonly hooks = new Map<LifecycleHooks, Function[]>()
    readonly ids: [string, number, number] = ['', 0, 0]
    rearrangeSession!: RearrangeSession
    props!: Readonly<Data>
    propStore!: PropStore
    structure!: RearrangeScope
    node: RearrangeNode | null = null
    contents: Contents = Object.freeze({})
    setupContext!: SetupContext
    isMounted = false
    isUnmounted = false
    isDeactivated = false

    constructor(readonly type: ArrangableDefinition, readonly parent: ArrangableInstance | null, readonly appContext: AppContext, readonly source?: string) {
        this.provides = Object.create(parent?.provides ?? appContext.provides)
    }
}

let nextInstanceId = 1
export let currentInstance: ArrangableInstance | null = null

export function getCurrentInstance(): ArrangableInstance | null {
    return currentInstance
}

export function setCurrentInstance(instance: ArrangableInstance, scope: EffectScope = instance.scope): () => void {
    const previous = currentInstance
    currentInstance = instance
    scope.on()

    return () => {
        scope.off()
        currentInstance = previous
    }
}

export function getArrangableName(definition: ArrangableDefinition): string | undefined {
    return definition.name ?? definition.__name
}
