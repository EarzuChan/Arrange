import { getCurrentScope, pauseTracking, ReactiveEffect, resetTracking, type EffectScope } from '@arrange/reactivity'
import type { ArrangableInstance } from './arrangable.ts'
import { arrangeExecutionStats } from './executionStats.ts'
import { queueJob, SchedulerJobFlags, type SchedulerJob } from './scheduler.ts'
import { callWithErrorHandling, ErrorCodes } from './errorHandling.ts'

export class ValueBinding {
    private effect: ReactiveEffect
    private readonly job: SchedulerJob
    private readonly scope: EffectScope
    private stopped = false
    private initialized = false
    private value: unknown
    private readonly update = { scope: () => this.owner.structure, dirty: () => this.dirty, run: () => this.refreshDirty() }
    private readonly cleanup = () => this.stop()

    get dirty(): boolean { return !this.stopped && !this.owner.isDeactivated && !this.owner.isUnmounted && this.effect.dirty }

    constructor(private read: () => unknown, private readonly owner: ArrangableInstance, private readonly write: (value: unknown, previous: unknown) => void, private source?: string, private readonly invalidate?: () => void) {
        this.scope = getCurrentScope() ?? owner.scope
        this.job = () => {
            if (!this.stopped && !owner.isDeactivated && !owner.isUnmounted) callWithErrorHandling(() => owner.rearrangeSession.runValue(this.update), owner, ErrorCodes.ARRANGABLE_UPDATE)
        }
        this.job.id = owner.uid
        this.job.i = owner
        this.effect = this.createEffect()
        this.scope.cleanups.push(this.cleanup)
        arrangeExecutionStats.activeValueBindings++

        try { this.effect.run() } catch (error) {
            this.stop()
            throw error
        }
    }

    private createEffect(): ReactiveEffect {
        const effect = this.scope.run(() => new ReactiveEffect(() => {
            arrangeExecutionStats.valueEvaluations++
            let value: unknown
            try { value = this.read() } catch (error) { throw this.annotate(error) }
            if (this.initialized && Object.is(value, this.value)) return

            pauseTracking()
            try {
                this.write(value, this.value)
                this.value = value
                this.initialized = true
                arrangeExecutionStats.valueWrites++
            } finally {
                resetTracking()
            }
        }))!
        effect.scheduler = () => {
            if (this.stopped || this.owner.isUnmounted || this.owner.rearrangeSession.reverting) return
            if (this.invalidate) this.invalidate()
            else if (this.owner.rearrangeSession.preparing) this.owner.rearrangeSession.runValue(this.update)
            else queueJob(this.job)
        }
        return effect
    }

    refreshDirty(): void {
        if (!this.stopped && this.effect.dirty) this.refresh(this.read, this.source)
    }

    refresh(read: () => unknown, source?: string): void {
        if (this.stopped) return
        const previous = { read: this.read, source: this.source, effect: this.effect, value: this.value, initialized: this.initialized }
        this.read = read
        this.source = source
        const candidate = this.createEffect()
        this.effect = candidate
        if (this.owner.rearrangeSession.preparing) {
            this.owner.rearrangeSession.onCommit(() => this.stopEffect(previous.effect))
            this.owner.rearrangeSession.onRollback(() => {
                this.stopEffect(candidate)
                this.read = previous.read
                this.source = previous.source
                this.effect = previous.effect
                this.value = previous.value
                this.initialized = previous.initialized
            })
        } else this.stopEffect(previous.effect)
        candidate.run()
    }

    currentValue(): unknown {
        return this.value
    }

    private annotate(error: unknown): unknown {
        if (error instanceof Error && this.source && !error.message.includes(this.source)) error.message += `\n来源：${this.source}`
        return error
    }

    private stopEffect(effect: ReactiveEffect): void {
        effect.stop()
        const index = this.scope.effects.indexOf(effect)
        if (index >= 0) this.scope.effects.splice(index, 1)
    }

    stop(): void {
        if (this.stopped) return
        this.stopped = true
        this.job.flags = (this.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
        arrangeExecutionStats.activeValueBindings--
        this.stopEffect(this.effect)
        const index = this.scope.cleanups.indexOf(this.cleanup)
        if (index >= 0) this.scope.cleanups.splice(index, 1)
    }
}