import { effectScope, onScopeDispose } from '@arrange/reactivity'
import { getCurrentInstance, setCurrentInstance, type ArrangableDefinition, type ArrangableInstance, type StructureProgram } from './arrangable.ts'
import { bindFrameScheduler } from './animationOwner.ts'

type Template = (scope: any) => StructureProgram
type Version = { definition: ArrangableDefinition; template: Template; script: string; contract: string; dependencies: readonly unknown[] }
type RecordEntry = { version: Version; identity: ArrangableDefinition; instances: Set<ArrangableInstance>; revision: number }
const records = new Map<string, RecordEntry>()
const definitions = new WeakMap<ArrangableDefinition, RecordEntry>()
const versions = new WeakMap<ArrangableDefinition, Version>()
const states = new WeakMap<ArrangableInstance, Map<string, unknown>>()
const stateReads = new WeakMap<ArrangableInstance, Set<string>>()

export function registerArrangableHmr(id: string, definition: ArrangableDefinition, template: Template, script: string, contract: string, dependencies: readonly unknown[] = []): void {
    const version = { definition, template, script, contract, dependencies }
    let record = records.get(id)
    if (!record) records.set(id, record = { version, identity: definition, instances: new Set(), revision: 0 })
    definitions.set(definition, record)
    versions.set(definition, version)
}

export function applyArrangableHmr(id: string, definition: ArrangableDefinition): void {
    const record = records.get(id)
    const next = versions.get(definition)
    if (!record || !next) throw new Error(`Arrangable HMR 定义未注册：${id}`)

    const compatible = record.version.contract === next.contract
    record.version = next
    if (!compatible) record.identity = definition
    record.revision++

    for (const instance of record.instances) {
        if (instance.isUnmounted) continue

        const scope = compatible ? instance.structure : instance.structure.parent
        if (scope) {
            invalidateConstants(scope)
            instance.rearrangeSession.schedule(scope, true)
        }
    }
}

function invalidateConstants(root: ArrangableInstance['structure']): void {
    const scopes = [root]
    const visited = new Set<ArrangableInstance>()

    while (scopes.length) {
        const scope = scopes.pop()!

        for (const entry of scope.entries) if (entry.kind === 'call') {
            if (visited.has(entry.instance)) continue
            visited.add(entry.instance)
            entry.instance.propStore.invalidateConstants()
            scopes.push(entry.instance.structure)
        } else scopes.push(entry.scope)

        for (const retained of scope.retainedContents.values()) for (const entry of retained.entries.values()) scopes.push(entry.scope)
    }
}

export function resolveHotArrangable(definition: ArrangableDefinition): ArrangableDefinition {
    return definitions.get(definition)?.identity ?? definition
}

export function inheritHotState(instance: ArrangableInstance, previous?: ArrangableInstance): void {
    const record = definitions.get(instance.type)
    if (!record || !previous || definitions.get(previous.type) !== record) return
    if (versions.get(previous.type)?.contract === record.version.contract) states.set(instance, new Map(states.get(previous)))
}

// 只迁移编译器识别的显式状态声明；computed/watch/生命周期由新 setup 重新建立
export function arrangableHotState<T>(key: string, initialize: () => T): T {
    const instance = getCurrentInstance()
    if (!instance) throw new Error('Arrangable HMR state 只能在 setup 中建立')
    let values = states.get(instance)
    if (!values) states.set(instance, values = new Map())
    stateReads.get(instance)?.add(key)
    if (!values.has(key)) values.set(key, initialize())
    return values.get(key) as T
}

export function bindArrangableHotTemplate(id: string, scope: object): StructureProgram {
    const instance = getCurrentInstance()
    const record = records.get(id)
    if (!instance || !record) throw new Error(`Arrangable HMR setup 缺少注册：${id}`)
    let revision = record.revision
    let program = record.version.template(scope)
    return () => {
        if (revision !== record.revision) {
            program = record.version.template(scope)
            revision = record.revision
        }
        return program()
    }
}

// setup 效应具有独立生命；兼容脚本更新在同一重排事务内交接，保留调用账本
export function setupHotArrangable(instance: ArrangableInstance, setup: () => StructureProgram): StructureProgram {
    const record = definitions.get(instance.type)
    if (!record) return setup()
    record.instances.add(instance)
    onScopeDispose(() => record.instances.delete(instance))
    const makeLifetime = () => instance.scope.run(() => effectScope())!
    let lifetime = makeLifetime()
    let version = record.version
    const run = (scope: typeof lifetime, factory: () => StructureProgram) => {
        bindFrameScheduler(scope, instance.rearrangeSession.scheduler)
        const previous = states.get(instance)
        const restoreState = () => {
            if (previous) states.set(instance, previous)
            else states.delete(instance)
        }
        states.set(instance, new Map(previous))
        const used = new Set<string>()
        stateReads.set(instance, used)
        const restore = setCurrentInstance(instance, scope)
        try {
            const program = factory()
            states.set(instance, new Map([...states.get(instance) ?? []].filter(([key]) => used.has(key))))
            instance.rearrangeSession.onRollback(restoreState)
            return program
        } catch (error) {
            restoreState()
            throw error
        } finally {
            stateReads.delete(instance)
            restore()
        }
    }
    let program: StructureProgram
    try { program = run(lifetime, () => record.version.definition.setup(instance.props, instance.setupContext)) } catch (error) {
        lifetime.stop()
        throw error
    }
    onScopeDispose(() => lifetime.stop())
    return () => {
        const next = record.version
        if (version.script !== next.script || version.dependencies.length !== next.dependencies.length || version.dependencies.some((dependency, index) => dependency !== next.dependencies[index])) {
            const previous = { lifetime, version, program, hooks: new Map(instance.hooks), provides: Object.getOwnPropertyDescriptors(instance.provides) }
            const restorePrevious = () => {
                instance.hooks.clear()
                for (const [key, value] of previous.hooks) instance.hooks.set(key, value)
                for (const key of Reflect.ownKeys(instance.provides)) delete instance.provides[key]
                Object.defineProperties(instance.provides, previous.provides)
            }
            const candidate = makeLifetime()
            instance.hooks.clear()
            const mounted = instance.isMounted
            instance.isMounted = false
            try {
                program = run(candidate, () => record.version.definition.setup(instance.props, instance.setupContext))
            } catch (error) {
                candidate.stop()
                restorePrevious()
                throw error
            } finally {
                instance.isMounted = mounted
            }
            lifetime = candidate
            version = record.version
            instance.rearrangeSession.onCommit(() => previous.lifetime.stop())
            instance.rearrangeSession.onRollback(() => {
                candidate.stop()
                lifetime = previous.lifetime
                version = previous.version
                program = previous.program
                restorePrevious()
            })
        }
        return program()
    }
}
