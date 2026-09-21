import { computed, effectScope, pauseTracking, ReactiveEffect, resetTracking, shallowRef, type EffectScope } from '@arrange/reactivity'
import { arrangeParameterName } from '@arrange/shared'
import { ArrangableInstance, setCurrentInstance, type AppContext, type ArrangableDefinition, type ArrangableProps, type CallMetadata, type CallPosition, type RearrangeKey, type Content, type Contents, type Data, type StructureProgram } from './arrangable.ts'
import { isArrangableDefinition } from './apiDefineArrangable.ts'
import { PropStore, type PropInputs } from './arrangableProps.ts'
import type { RearrangeNode } from './rearrangeNode.ts'
import { LifecycleHooks } from './enums.ts'
import { FrameScheduler, queueJob, queueRearrangeJob, SchedulerJobFlags, type SchedulerJob } from './scheduler.ts'
import { arrangeExecutionStats } from './executionStats.ts'
import { callWithErrorHandling, ErrorCodes } from './errorHandling.ts'
import { ValueBinding } from './valueBinding.ts'
import { bindFrameScheduler } from './animationOwner.ts'

interface CallEntry {
    readonly kind: 'call'
    readonly position: CallPosition
    readonly key: RearrangeKey
    readonly instance: ArrangableInstance
}

interface ScopeEntry {
    readonly kind: 'scope'
    readonly position: CallPosition
    readonly key: RearrangeKey
    readonly scope: RearrangeScope
    readonly retention?: RetainedContents
}

type Entry = CallEntry | ScopeEntry
export interface ValueTask {
    scope(): RearrangeScope
    dirty(): boolean
    run(): void
}
let activeScope: RearrangeScope | null = null
let nextScopeId = 1

// 账本只保存已建立调用和范围，不创建等待 patch 的描述树
export class RearrangeScope {
    readonly identity = nextScopeId++
    readonly lifetime: EffectScope = effectScope(true)
    effect: ReactiveEffect
    readonly job: SchedulerJob
    entries: Entry[] = []
    readonly retainedContents = new Map<CallPosition, RetainedContents>()
    readonly parameterObjects = new Map<CallPosition, ObjectParameterBinding>()
    readonly usedParameterObjects = new Set<CallPosition>()
    retired = false
    paused = false
    private candidateEffect: ReactiveEffect | undefined
    private used = new Set<Entry>()
    private next: Entry[] = []
    private index = new Map<CallPosition, Map<RearrangeKey, Entry>>()

    constructor(readonly rearrangeSession: RearrangeSession, readonly owner: ArrangableInstance | null, readonly parent: RearrangeScope | null, private program: StructureProgram, readonly source: string | undefined = owner?.source ?? parent?.source) {
        this.effect = this.makeEffect()
        this.job = () => {
            if (this.retired || this.paused || this.owner?.isUnmounted || !this.effect.dirty) return
            rearrangeSession.schedule(this)
        }
        this.job.i = owner ?? undefined
        this.job.scheduler = rearrangeSession.scheduler

    }

    private makeEffect(): ReactiveEffect {
        const effect = this.lifetime.run(() => new ReactiveEffect(() => this.execute()))!
        effect.scheduler = () => {
            if (this.retired || this.rearrangeSession.reverting) return
            if (this.rearrangeSession.preparing) this.rearrangeSession.enqueue(this)
            else queueJob(this.job)
        }
        return effect
    }

    prepare(force: boolean): void {
        const current = this.candidateEffect ?? this.effect
        if (!force && !current.dirty) return
        if (!this.candidateEffect) {
            const committed = this.effect
            const candidate = this.makeEffect()
            this.candidateEffect = candidate
            this.rearrangeSession.onRollback(() => {
                this.stopEffect(candidate)
                this.candidateEffect = undefined
            })
            this.rearrangeSession.onCommit(() => {
                this.stopEffect(committed)
                this.effect = candidate
                this.candidateEffect = undefined
            })
        }
        this.candidateEffect.run()
    }

    private stopEffect(effect: ReactiveEffect): void {
        effect.stop()
        const index = this.lifetime.effects.indexOf(effect)
        if (index >= 0) this.lifetime.effects.splice(index, 1)
    }

    refresh(program: StructureProgram): void {
        const previous = this.program
        this.rearrangeSession.onRollback(() => { this.program = previous })
        this.program = program
        this.rearrangeSession.enqueue(this, program !== previous)
    }

    publish(entries: Entry[]): void {
        this.entries = entries
        this.index.clear()
        for (const entry of entries) {
            let keys = this.index.get(entry.position)
            if (!keys) this.index.set(entry.position, keys = new Map())
            keys.set(entry.key, entry)
        }
    }

    claim(position: CallPosition, key: RearrangeKey): Entry | undefined {
        const entry = this.index.get(position)?.get(key)
        if (entry && this.used.has(entry)) throw new TypeError(`重排范围中出现重复调用身份：${String(position)} / ${String(key)}`)
        if (entry) this.used.add(entry)
        return entry
    }

    record(entry: Entry): void {
        if (this.next.some(item => item.position === entry.position && Object.is(item.key, entry.key))) throw new TypeError(`重排范围中出现重复调用身份：${String(entry.position)} / ${String(entry.key)}`)
        this.next.push(entry)
    }

    private execute(): void {
        if (this.retired || this.paused) return
        const previous = activeScope
        activeScope = this
        const restore = this.owner ? setCurrentInstance(this.owner) : undefined
        this.index.clear()
        for (const entry of this.rearrangeSession.entries(this)) {
            let keys = this.index.get(entry.position)
            if (!keys) this.index.set(entry.position, keys = new Map())
            keys.set(entry.key, entry)
        }
        this.rearrangeSession.preserve(this.index, () => () => this.publish(this.entries))
        this.used.clear()
        this.usedParameterObjects.clear()
        this.next = []
        arrangeExecutionStats.structureRuns++
        try {
            if (this.program() !== undefined) throw new TypeError('结构程序只执行调用，不能返回节点描述、数组或文本')
            this.rearrangeSession.stage(this, this.next)
            this.rearrangeSession.preserve(this.parameterObjects, () => {
                this.rearrangeSession.onCommit(() => {
                    for (const [position, parameter] of this.parameterObjects) {
                        if (this.usedParameterObjects.has(position)) continue
                        parameter.binding.stop()
                        this.parameterObjects.delete(position)
                    }
                })
                return () => { }
            })
            this.rearrangeSession.changed(this)
        } finally {
            restore?.()
            activeScope = previous
        }
    }

    pause(): void {
        visitScopes(this, scope => {
            scope.paused = true
            scope.lifetime.pause()
            if (scope.owner?.structure === scope) {
                scope.owner.isDeactivated = true
                scope.owner.scope.pause()
            }
        })
    }

    resume(): void {
        visitScopes(this, scope => {
            scope.paused = false
            scope.lifetime.resume()
            if (scope.owner?.structure === scope) {
                scope.owner.isDeactivated = false
                scope.owner.node?.activate()
                scope.owner.scope.resume()
            }
            this.rearrangeSession.enqueue(scope, true)
        })
    }

    retire(notify = true): void {
        retireEntries([{ kind: 'scope', scope: this, position: 0, key: undefined }], notify)
    }

    detach(): Entry[] {
        this.retired = true
        this.job.flags = (this.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
        const entries = [...this.entries]
        for (const cache of this.retainedContents.values()) {
            cache.closed = true
            entries.push(...cache.entries.values())
            cache.entries.clear()
        }
        this.retainedContents.clear()
        this.parameterObjects.clear()
        this.entries = []
        this.index.clear()
        return entries
    }

}

export class RearrangeSession {
    readonly scheduler: FrameScheduler
    readonly root: RearrangeScope
    private readonly work = new Map<RearrangeScope, boolean>()
    private readonly dirtyParents = new Set<ArrangableInstance | null>()
    private readonly candidates = new Map<RearrangeScope, Entry[]>()
    private readonly activeScopes = new Map<RearrangeScope, boolean>()
    private readonly created = new Set<Entry>()
    private readonly commits: (() => void)[] = []
    private readonly rollbacks: (() => void)[] = []
    private readonly notifications = new Map<ArrangableInstance, Set<LifecycleHooks>>()
    private readonly deferred = new Map<RearrangeScope, boolean>()
    private readonly values = new Set<ValueTask>()
    private readonly checkpoints = new Set<object>()
    reverting = false
    private readonly deferredValues = new Set<ValueTask>()
    private running = false
    private applying = false
    private disposed = false
    private failed: { error: unknown } | undefined
    private transaction: object | undefined

    private readonly job: SchedulerJob = () => {
        try { this.run(null) } catch (error) { this.report(error) }
    }

    constructor(readonly context: AppContext, definition: ArrangableDefinition, inputs: PropInputs<Data>) {
        this.scheduler = new FrameScheduler(pending => context.host.requestFrame(pending), () => context.host.currentTime())
        this.job.scheduler = this.scheduler
        this.root = new RearrangeScope(this, null, null, () => callArrangable(0, definition, inputs))
    }

    invalidate(error: unknown): void {
        this.failed ??= { error }
    }

    get preparing(): boolean { return this.running && !this.applying }

    mount(): void {
        this.schedule(this.root, true)
    }

    enqueue(scope: RearrangeScope, force = false): void {
        this.work.set(scope, force || this.work.get(scope) === true)
    }

    hasCandidate(scope: RearrangeScope): boolean {
        return this.candidates.has(scope)
    }

    preserve(target: object, checkpoint: () => () => void): void {
        if (this.checkpoints.has(target)) return
        this.checkpoints.add(target)
        this.onRollback(checkpoint())
    }

    stage(scope: RearrangeScope, entries: Entry[]): void {
        this.candidates.set(scope, entries)
        this.activeScopes.clear()
    }

    private isActive(scope: RearrangeScope): boolean {
        const pending: RearrangeScope[] = []
        let current: RearrangeScope | null = scope
        let active = true
        while (current) {
            if (this.activeScopes.has(current)) {
                active = this.activeScopes.get(current)!
                break
            }
            pending.push(current)
            if (current.retired || current.paused) {
                active = false
                break
            }
            const parent: RearrangeScope | null = current.parent
            if (parent && !this.entries(parent).some(entry => (entry.kind === 'call' ? entry.instance.structure : entry.scope) === current)) {
                active = false
                break
            }
            current = parent
        }
        for (const scope of pending) this.activeScopes.set(scope, active)
        return active
    }

    private discardUnusedCandidates(): void {
        const abandoned: Entry[] = []
        for (const entry of this.created) {
            const scope = entry.kind === 'call' ? entry.instance.structure : entry.scope
            if (!this.isActive(scope)) {
                abandoned.push(entry)
                this.created.delete(entry)
            }
        }
        retireEntries(abandoned, false)
        for (const scope of this.candidates.keys()) if (!this.isActive(scope)) this.candidates.delete(scope)
    }

    createdEntry(entry: Entry): void {
        this.created.add(entry)
    }

    entries(scope: RearrangeScope): Entry[] {
        return this.candidates.get(scope) ?? scope.entries
    }

    onCommit(callback: () => void): void {
        this.commits.push(callback)
    }

    onRollback(callback: () => void): void {
        this.rollbacks.push(callback)
    }

    notify(instance: ArrangableInstance, hook: LifecycleHooks): void {
        let hooks = this.notifications.get(instance)
        if (!hooks) this.notifications.set(instance, hooks = new Set())
        hooks.add(hook)
    }

    changed(scope: RearrangeScope): void {
        let owner = scope.owner
        while (owner && !owner.node) owner = owner.parent
        this.dirtyParents.add(owner)
    }

    runValue(update: ValueTask): void {
        if (this.disposed || this.reverting || !update.dirty()) return
        if (this.applying) {
            this.deferredValues.add(update)
            return
        }
        this.values.add(update)
        if (!this.running) queueRearrangeJob(this.job)
    }

    schedule(scope: RearrangeScope, force = false): void {
        if (this.disposed || scope.retired || scope.paused || !force && !scope.effect.dirty) return
        if (this.applying) {
            this.deferred.set(scope, force || this.deferred.get(scope) === true)
            return
        }
        this.enqueue(scope, force)
        queueRearrangeJob(this.job)
    }

    run(scope: RearrangeScope | null, force = false): void {
        if (this.disposed || scope?.retired) return
        if (this.applying) {
            if (scope) this.deferred.set(scope, force || this.deferred.get(scope) === true)
            return
        }
        if (scope) this.enqueue(scope, force)
        if (this.running) return
        for (const task of this.values) if (!task.dirty()) this.values.delete(task)
        for (const [target, forced] of this.work) if (target.retired || target.paused || !forced && !target.effect.dirty) this.work.delete(target)
        if (!this.values.size && !this.work.size) return
        this.running = true
        const transaction = this.transaction = {}
        try {
            this.context.host.begin()
            const executions = new Map<RearrangeScope | ValueTask, number>()
            const visit = (target: RearrangeScope | ValueTask) => {
                const count = (executions.get(target) ?? 0) + 1
                if (count > 100) throw new Error(`重排候选反复失效，未能稳定${target instanceof RearrangeScope && target.source ? `\n来源：${target.source}` : ''}`)
                executions.set(target, count)
            }
            while (this.values.size || this.work.size || this.scheduler.hasPreWork) {
                this.scheduler.drainPre()
                let scope: RearrangeScope | undefined
                for (const candidate of this.work.keys()) if (!scope || candidate.identity < scope.identity) scope = candidate
                let update: ValueTask | undefined
                for (const candidate of this.values) if (!update || candidate.scope().identity < update.scope().identity) update = candidate
                if (update && (!scope || update.scope().identity <= scope.identity)) {
                    this.values.delete(update)
                    if (this.isActive(update.scope()) && update.dirty()) {
                        visit(update)
                        update.run()
                    }
                } else if (scope) {
                    const force = this.work.get(scope)!
                    this.work.delete(scope)
                    if (this.isActive(scope)) {
                        visit(scope)
                        scope.prepare(force)
                    }
                }
            }
            if (this.failed) throw this.failed.error
            this.discardUnusedCandidates()
            for (const owner of this.dirtyParents) {
                if (owner && !this.isActive(owner.structure)) continue
                if (owner) owner.node!.reconcileChildren(collectNodes(owner.structure))
                else this.context.host.reconcileRoots(collectNodes(this.root))
            }
            this.applying = true
            this.context.host.apply(error => { if (this.transaction === transaction) this.complete(error) })
        } catch (error) {
            if (this.transaction === transaction) {
                try { this.abort() } catch (cleanup) { throw new AggregateError([error, cleanup], '重排失败且撤销清理发生错误') }
            }
            throw error
        } finally {
            this.running = false
            this.work.clear()
        }
    }

    private complete(error?: Error): void {
        if (error) {
            let failure: unknown = error
            try { this.abort() } catch (cleanup) { failure = new AggregateError([error, cleanup], '重排应用失败且撤销清理发生错误') }
            this.report(failure)
            return
        }
        // 收到成功回执后不能再撤销，后续清理和用户通知中的异常单独报告
        this.transaction = undefined
        const errors: unknown[] = []
        const safely = (operation: () => void) => { try { operation() } catch (error) { errors.push(error) } }
        const exits: Entry[] = []
        for (const [scope, entries] of this.candidates) {
            const retained = new Set(entries)
            for (const previous of scope.entries) if (!retained.has(previous)) exits.push(previous)
            scope.publish(entries)
        }
        for (const commit of this.commits) safely(commit)
        const notifications = new Map(this.notifications)
        this.clearCandidate()

        try {
            const retired: Entry[] = []
            for (const entry of exits) {
                if (entry.kind === 'scope' && entry.retention && entry.retention.entries.get(entry.key) === entry) safely(() => entry.retention!.deactivate(entry))
                else retired.push(entry)
            }
            safely(() => retireEntries(retired))
            const pending: (RearrangeScope | ArrangableInstance)[] = [this.root]
            while (pending.length) {
                const next = pending.pop()!
                if (next instanceof ArrangableInstance) {
                    if (next.isUnmounted) continue
                    const hooks = notifications.get(next)
                    if (!hooks) continue
                    next.isMounted = true
                    for (const hook of hooks) safely(() => runHooks(next, hook))
                } else {
                    if (next.retired || next.paused) continue
                    if (next.owner?.structure === next) pending.push(next.owner)
                    for (let index = next.entries.length - 1; index >= 0; index--) {
                        const entry = next.entries[index]
                        pending.push(entry.kind === 'call' ? entry.instance.structure : entry.scope)
                    }
                }
            }
        } finally {
            this.applying = false
            this.scheduleDeferred()
        }
        if (errors.length) this.report(new AggregateError(errors, '重排已成功提交，但生命周期清理或通知发生错误'))
    }

    private report(error: unknown): void {
        const owner = this.root.entries.find(entry => entry.kind === 'call')?.instance
        if (owner) callWithErrorHandling(() => { throw error }, owner, ErrorCodes.ARRANGABLE_UPDATE)
        else if (this.context.config.errorHandler) this.context.config.errorHandler(error, undefined, String(ErrorCodes.ARRANGABLE_UPDATE))
        else throw error
    }

    private abort(): void {
        this.scheduler.reject()
        this.transaction = undefined
        this.reverting = true
        const errors: unknown[] = []
        const safely = (operation: () => void) => { try { operation() } catch (error) { errors.push(error) } }
        try {
            safely(() => this.context.host.rollback())
            for (let index = this.rollbacks.length - 1; index >= 0; index--) safely(this.rollbacks[index])
            safely(() => retireEntries([...this.created], false))
        } finally {
            this.clearCandidate()
            this.work.clear()
            this.values.clear()
            this.applying = false
            this.reverting = false
            this.scheduleDeferred()
        }
        if (errors.length) throw new AggregateError(errors, '撤销候选时发生清理错误')
    }

    private clearCandidate(): void {
        this.candidates.clear()
        this.activeScopes.clear()
        this.created.clear()
        this.commits.length = 0
        this.rollbacks.length = 0
        this.notifications.clear()
        this.dirtyParents.clear()
        this.checkpoints.clear()
        this.failed = undefined
    }

    private scheduleDeferred(): void {
        for (const [scope, force] of this.deferred) {
            this.schedule(scope, force)
        }
        this.deferred.clear()
        for (const update of this.deferredValues) this.runValue(update)
        this.deferredValues.clear()
    }

    dispose(): void {
        if (this.disposed || this.reverting) return
        this.disposed = true
        this.scheduler.dispose()
        this.job.flags = SchedulerJobFlags.DISPOSED
        const errors: unknown[] = []
        try { if (this.transaction) this.abort() } catch (error) { errors.push(error) }
        try { this.root.retire() } catch (error) { errors.push(error) }
        this.work.clear()
        this.values.clear()
        this.deferred.clear()
        this.deferredValues.clear()
        if (errors.length) throw new AggregateError(errors, '卸载组合时发生清理错误')
    }
}

/** @arrangeCall */
export function callArrangable<D extends ArrangableDefinition>(position: CallPosition, definition: D, inputs: PropInputs<ArrangableProps<D>>, contents: Contents = {}, metadata: CallMetadata = {}): void {
    const scope = requireScope()
    pauseTracking()
    try {
        if (!isArrangableDefinition(definition)) throw new TypeError('调用目标必须是已声明的 Arrangable 定义')

        const normalized = metadata.parameters ? inputs : normalizeInputs(inputs)
        validateContents(definition, contents)
        const previous = scope.claim(position, metadata.key)
        let entry: CallEntry
        if (previous?.kind === 'call' && previous.instance.type === definition) {
            arrangeExecutionStats.instancesReused++
            entry = previous
            entry.instance.propStore.update(normalized, metadata)
            if (updateContents(entry.instance, contents)) scope.rearrangeSession.enqueue(entry.instance.structure, true)
        } else {
            const instance = new ArrangableInstance(definition, scope.owner, scope.rearrangeSession.context, metadata.source)
            arrangeExecutionStats.instancesCreated++
            entry = { kind: 'call', position, key: metadata.key, instance }
            initializeInstance(instance, scope, normalized, contents, metadata)
            scope.rearrangeSession.createdEntry(entry)
        }
        scope.record(entry)
    } catch (error) {
        if (error instanceof Error && metadata.source && !error.message.includes('来源：')) error.message += `\n来源：${metadata.source}`
        scope.rearrangeSession.invalidate(error)
        throw error
    } finally {
        resetTracking()
    }
}

function initializeInstance(instance: ArrangableInstance, parent: RearrangeScope, inputs: PropInputs<Data>, contents: Contents, metadata: CallMetadata): void {
    instance.rearrangeSession = parent.rearrangeSession
    bindFrameScheduler(instance.scope, parent.rearrangeSession.scheduler)
    const restore = setCurrentInstance(instance)
    try {
        instance.propStore = new PropStore(instance)
        instance.props = instance.propStore.values
        instance.propStore.update(inputs, metadata)
        instance.contents = contents
        const contentVersion = shallowRef(0)
        const invoke = (name: string) => {
            contentVersion.value
            if (instance.contents[name]?.() !== undefined) throw new TypeError('内容函数只能执行 Arrangable 调用，不能返回文本或节点描述')
        }
        contentVersions.set(instance, contentVersion)
        const slotFunctions = new Map<string, Content>()
        const slots = new Proxy(Object.create(null) as Record<string, Content>, {
            ownKeys: () => {
                contentVersion.value
                return instance.type.contentTarget ? Object.keys(instance.contents) : [...instance.type.slotNames]
            },
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
            get: (_target, name) => {
                if (typeof name !== 'string') return undefined
                if (!slotFunctions.has(name)) slotFunctions.set(name, () => invoke(name))
                return slotFunctions.get(name)
            },
        })
        instance.setupContext = {
            slots,
            call: callArrangable,
            slot: (name = 'default') => {
                if (!instance.type.contentTarget && !instance.type.slotNames.includes(name)) throw new TypeError(`Arrangable 未声明内容：${name}`)
                return instance.setupContext.slots[name]!
            },
            source: name => instance.propStore.source(name),
        }
        const program = instance.type.setup(instance.props, instance.setupContext)
        if (typeof program !== 'function') throw new TypeError('Arrangable setup 必须返回结构执行函数，不支持异步 setup')
        instance.structure = new RearrangeScope(parent.rearrangeSession, instance, parent, () => {
            runHooks(instance, instance.isMounted ? LifecycleHooks.BEFORE_UPDATE : LifecycleHooks.BEFORE_MOUNT)
            if (program() !== undefined) throw new TypeError('结构程序只执行调用，不能返回节点描述、数组或文本')
            parent.rearrangeSession.notify(instance, instance.isMounted ? LifecycleHooks.UPDATED : LifecycleHooks.MOUNTED)
        }, metadata.source)
        parent.rearrangeSession.enqueue(instance.structure, true)
    } catch (error) {
        instance.isUnmounted = true
        arrangeExecutionStats.instancesRetired++
        instance.node?.retire()
        instance.scope.stop()
        throw error
    } finally {
        restore()
    }
}

const contentVersions = new WeakMap<ArrangableInstance, ReturnType<typeof shallowRef<number>>>()

function updateContents(instance: ArrangableInstance, contents: Contents): boolean {
    const before = instance.contents
    if (before === contents || Object.keys(before).length === Object.keys(contents).length && Object.keys(contents).every(name => before[name] === contents[name])) return false
    const version = contentVersions.get(instance)!
    const previousVersion = version.value
    instance.rearrangeSession.onRollback(() => {
        instance.contents = before
        version.value = previousVersion
    })
    instance.contents = contents
    version.value = (version.value ?? 0) + 1
    return true
}

export function arrangeScope(position: CallPosition, program: StructureProgram, key?: RearrangeKey, source?: string): void {
    const parent = requireScope()
    const previous = parent.claim(position, key)
    let entry: ScopeEntry

    if (previous?.kind === 'scope') {
        entry = previous
        entry.scope.refresh(program)
    } else {
        const scope = new RearrangeScope(parent.rearrangeSession, parent.owner, parent, program, source)
        entry = { kind: 'scope', position, key, scope }
        parent.rearrangeSession.createdEntry(entry)
        parent.rearrangeSession.enqueue(scope, true)
    }

    parent.record(entry)
}

class RetainedContents {
    readonly entries = new Map<RearrangeKey, ScopeEntry>()
    closed = false

    deactivate(entry: ScopeEntry): void {
        entry.scope.pause()
        const instances: ArrangableInstance[] = []
        visitScopes(entry.scope, scope => {
            if (scope.owner?.structure === scope) {
                scope.owner.node?.deactivate()
                instances.push(scope.owner)
            }
        })
        for (let index = instances.length - 1; index >= 0; index--) runHooks(instances[index], LifecycleHooks.DEACTIVATED)
    }
}

export function retainContent(position: CallPosition, key: RearrangeKey, content: Content, max: number): void {
    const parent = requireScope()
    if (!(max > 0) || !Number.isInteger(max)) throw new TypeError('内容保留上限必须是正整数')
    let cache = parent.retainedContents.get(position)
    if (!cache) {
        cache = new RetainedContents()
        parent.retainedContents.set(position, cache)
        parent.rearrangeSession.onRollback(() => { parent.retainedContents.delete(position) })
    }
    const retained = cache
    const candidate = parent.rearrangeSession.entries(parent).find(entry => entry.kind === 'scope' && entry.retention === retained && entry.position === position && Object.is(entry.key, key))
    let entry = candidate?.kind === 'scope' ? candidate : retained.entries.get(key)
    if (entry) {
        entry.scope.refresh(content)
        if (entry.scope.paused) {
            entry.scope.resume()
            parent.rearrangeSession.onRollback(() => entry!.scope.pause())
            visitScopes(entry.scope, scope => {
                if (scope.owner?.structure === scope) parent.rearrangeSession.notify(scope.owner, LifecycleHooks.ACTIVATED)
            })
        }
    } else {
        const scope = new RearrangeScope(parent.rearrangeSession, parent.owner, parent, content)
        entry = { kind: 'scope', position, key, scope, retention: retained }
        parent.rearrangeSession.createdEntry(entry)
        parent.rearrangeSession.enqueue(scope, true)
    }
    parent.record(entry)
    const selected = entry
    parent.rearrangeSession.onCommit(() => {
        if (retained.closed || selected.scope.retired || !parent.rearrangeSession.entries(parent).includes(selected)) return
        retained.entries.delete(key)
        retained.entries.set(key, selected)
        while (retained.entries.size > max) {
            const [oldKey, old] = retained.entries.entries().next().value!
            retained.entries.delete(oldKey)
            retireEntries([old])
        }
    })
}

export function invokeContent(position: CallPosition, content: Content): void {
    arrangeScope(position, content)
}

function requireScope(): RearrangeScope {
    if (!activeScope || activeScope.retired) throw new Error('结构调用只能在活动重排作用域中执行')
    return activeScope
}

function collectNodes(scope: RearrangeScope): RearrangeNode[] {
    const nodes: RearrangeNode[] = []
    const pending = [...scope.rearrangeSession.entries(scope)].reverse()
    while (pending.length) {
        const entry = pending.pop()!
        if (entry.kind === 'call' && entry.instance.node) nodes.push(entry.instance.node)
        else {
            const nested = entry.kind === 'scope' ? entry.scope : entry.instance.structure
            const entries = scope.rearrangeSession.entries(nested)
            for (let index = entries.length - 1; index >= 0; index--) pending.push(entries[index])
        }
    }
    return nodes
}

function visitScopes(root: RearrangeScope, visit: (scope: RearrangeScope) => void): void {
    const pending = [root]
    while (pending.length) {
        const scope = pending.pop()!
        if (scope.retired) continue
        visit(scope)
        for (let index = scope.entries.length - 1; index >= 0; index--) {
            const entry = scope.entries[index]
            pending.push(entry.kind === 'scope' ? entry.scope : entry.instance.structure)
        }
    }
}

function retireEntries(entries: readonly Entry[], notify = true): void {
    const pending: (Entry | (() => void))[] = [...entries].reverse()
    const errors: unknown[] = []
    const safely = (operation: () => void) => {
        try { operation() } catch (error) { errors.push(error) }
    }
    while (pending.length) {
        const next = pending.pop()!
        if (typeof next === 'function') {
            safely(next)
            continue
        }
        const instance = next.kind === 'call' ? next.instance : null
        const scope = next.kind === 'scope' ? next.scope : next.instance.structure
        if (scope.retired || instance?.isUnmounted) continue
        if (instance) {
            if (notify) safely(() => runHooks(instance, LifecycleHooks.BEFORE_UNMOUNT))
            instance.isUnmounted = true
            arrangeExecutionStats.instancesRetired++
            pending.push(() => {
                safely(() => instance.propStore.stop())
                safely(() => instance.scope.stop())
                safely(() => instance.node?.retire())
                if (notify) safely(() => runHooks(instance, LifecycleHooks.UNMOUNTED))
            })
        }
        const children = scope.detach()
        safely(() => scope.lifetime.stop())
        for (let index = children.length - 1; index >= 0; index--) pending.push(children[index])
    }
    if (errors.length) throw new AggregateError(errors, '退休清理发生错误')
}

export function runHooks(instance: ArrangableInstance, hook: LifecycleHooks): void {
    pauseTracking()
    const restore = setCurrentInstance(instance)
    const errors: unknown[] = []
    try {
        for (const callback of instance.hooks.get(hook) ?? []) {
            try { callback() } catch (error) { errors.push(error) }
        }
    } finally {
        restore()
        resetTracking()
    }
    if (errors.length) throw new AggregateError(errors, '生命周期回调发生错误')
}

const normalizedInputs = new WeakMap<object, PropInputs<Data>>()

function normalizeInputs(inputs: PropInputs<Data>): PropInputs<Data> {
    const cached = normalizedInputs.get(inputs)
    if (cached) {
        arrangeExecutionStats.parameterCacheHits++
        return cached
    }
    const result: Record<string, () => unknown> = Object.create(null)
    for (const [original, getter] of Object.entries(inputs)) {
        arrangeExecutionStats.parameterNameChecks++
        const name = arrangeParameterName(original)
        if (Object.prototype.hasOwnProperty.call(result, name)) throw new TypeError(`重复参数：${name}`)
        result[name] = getter
    }
    if (Object.isFrozen(inputs)) normalizedInputs.set(inputs, Object.freeze(result))
    return result
}

function validateContents(definition: ArrangableDefinition, contents: Contents): void {
    for (const [name, content] of Object.entries(contents)) {
        if (!definition.contentTarget && !definition.slotNames.includes(name)) throw new TypeError(`Arrangable 未声明内容：${name}`)
        if (typeof content !== 'function') throw new TypeError(`内容 ${name} 必须是无参数结构函数`)
    }
}

export function arrangeList<T>(position: CallPosition, collection: Iterable<T> | Record<string, T> | number, identity: (item: T, key: any, index: number) => RearrangeKey, program: (item: T, key: any, index: number) => void): void {
    const values: [T, string | number, number][] = typeof collection === 'number' ? Array.from({ length: collection }, (_, index) => [index + 1 as T, index, index]) : Symbol.iterator in collection ? [...collection as Iterable<T>].map((value, index) => [value, index, index]) : Object.entries(collection).map(([key, value], index) => [value, key, index])
    for (const [value, key, index] of values) arrangeScope(position, () => program(value, key, index), identity(value, key, index) ?? index)
}

/** @arrangeParameterInputs */
export function parameterInputs(entries: readonly (readonly [string, () => unknown])[], source?: string): PropInputs<Data> {
    const inputs: Record<string, () => unknown> = Object.create(null)
    for (const [original, getter] of entries) {
        const name = arrangeParameterName(original)
        if (Object.prototype.hasOwnProperty.call(inputs, name)) throw new TypeError(`重复参数：${name}${source ? `\n来源：${source}` : ''}`)
        inputs[name] = getter
    }
    return inputs
}

class ObjectParameterBinding {
    readonly value = shallowRef<Record<string, unknown>>({})
    readonly shape = computed<readonly string[]>((previous) => {
        const names = Object.keys(this.value.value)
        return previous && previous.length === names.length && names.every((name, index) => previous[index] === name) ? previous : names
    })
    readonly binding: ValueBinding

    constructor(read: () => Record<string, unknown>, readonly scope: RearrangeScope) {
        this.binding = scope.lifetime.run(() => new ValueBinding(read, scope.owner!, value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('对象参数绑定必须提供对象')
            scope.rearrangeSession.preserve(this, () => {
                const previous = this.value.value
                return () => { this.value.value = previous }
            })
            this.value.value = value as Record<string, unknown>
        }, scope.source))!
    }
}

/** @arrangeParameterObject */
export function parameterObject(position: CallPosition, read: () => Record<string, unknown>): [string, () => unknown][] {
    const scope = requireScope()
    if (!scope.owner) throw new Error('对象参数绑定必须归属 Arrangable 调用')
    scope.usedParameterObjects.add(position)
    let parameter = scope.parameterObjects.get(position)
    pauseTracking()
    try {
        if (parameter) parameter.binding.refresh(read)
        else {
            parameter = new ObjectParameterBinding(read, scope)
            scope.parameterObjects.set(position, parameter)
            scope.rearrangeSession.onRollback(() => {
                parameter!.binding.stop()
                scope.parameterObjects.delete(position)
            })
        }
    } finally {
        resetTracking()
    }
    const value = parameter.value
    return parameter.shape.value.map(name => [name, () => value.value[name]])
}
