import { computed, type EffectScope, getCurrentScope, pauseTracking, ReactiveEffect, resetTracking } from '@arrange/vue-reactivity'
import { isReservedProp, normalizeParameterObject } from '@arrange/vue-shared'
import type { ArrangableInstance } from './arrangable.ts'
import { callWithErrorHandling, ErrorCodes } from './errorHandling.ts'
import { arrangeExecutionStats } from './executionStats.ts'
import { queueJob, type SchedulerJob, SchedulerJobFlags } from './scheduler.ts'

const measureNow = () => (performance as Performance & { measureNow?: () => number }).measureNow?.() ?? performance.now()

const valueExpression = Symbol('Arrange value expression')

export interface ValueExpression<T = unknown> {
    readonly [valueExpression]: true
    readonly read: () => T
    readonly source?: string
}

// 编译器把普通模板表达式延后；用户的 Ref 本身不携带用途或阶段
export function arrangeValue<T>(read: () => T, source?: string): ValueExpression<T> {
    arrangeExecutionStats.valueDescriptions++
    return { [valueExpression]: true, read, source }
}

export function isValueExpression(value: unknown): value is ValueExpression {
    return !!value && typeof value === 'object' && valueExpression in value
}

// 对象绑定的键集合与 key 属于结构，普通字段仍在值域读取
// shape computed 复用相等结果，值变化只会唤醒实际字段消费者
export function arrangeProps(read: () => Record<string, unknown> | null | undefined, source?: string): Record<string, unknown> {
    arrangeExecutionStats.dynamicParameterGroups++
    const values = computed(() => {
        try { return normalizeParameterObject(read()) } catch (error) {
            if (error instanceof Error && source && !error.message.includes(source)) error.message += `\n来源：${source}`
            throw error
        }
    })
    const shape = computed((previous?: { keys: string[]; reserved: unknown[] }) => {
        const value = values.value
        const keys = Object.keys(value)
        const reserved = keys.filter(isReservedProp).map(key => value[key])
        if (previous && keys.length === previous.keys.length && keys.every((key, index) => key === previous.keys[index])
            && reserved.length === previous.reserved.length && reserved.every((item, index) => Object.is(item, previous.reserved[index]))) return previous
        return { keys, reserved }
    })
    const { keys, reserved } = shape.value
    let reservedIndex = 0
    return Object.fromEntries(keys.map(key => [key, isReservedProp(key) ? reserved[reservedIndex++] : arrangeValue(() => values.value[key], source)]))
}

export class ValueBinding {
    private read: () => unknown
    private effect: ReactiveEffect
    private job: SchedulerJob
    private stopped = false
    private initialized = false
    private value: unknown
    private scope: EffectScope | undefined
    private source?: string

    constructor(
        expression: ValueExpression,
        owner: ArrangableInstance | null,
        private write: (value: unknown, previous: unknown) => void,
    ) {
        this.read = expression.read
        this.source = expression.source
        this.scope = getCurrentScope() ?? owner?.scope
        const evaluate = () => new ReactiveEffect(() => {
            arrangeExecutionStats.valueEvaluations++
            const started = measureNow()
            let value: unknown
            try { value = this.read() } catch (error) { throw this.annotate(error) } finally { arrangeExecutionStats.valueEvaluationMillis += measureNow() - started }
            if (!this.initialized || !Object.is(value, this.value)) {
                const previous = this.value
                pauseTracking()
                try {
                    this.write(value, previous)
                    this.value = value
                    this.initialized = true
                    arrangeExecutionStats.valueWrites++
                } catch (error) { throw this.annotate(error) } finally { resetTracking() }
            }
        })
        this.effect = this.scope ? this.scope.run(evaluate)! : evaluate()
        this.job = () => {
            if (!this.stopped) callWithErrorHandling(() => this.effect.runIfDirty(), owner, ErrorCodes.ARRANGABLE_UPDATE)
        }
        // 同一Arrangable结构先处理，已删除分支的绑定在执行前被停止
        this.job.id = owner ? owner.uid + 0.5 : Infinity
        this.job.i = owner ?? undefined
        arrangeExecutionStats.activeValueBindings++
        this.effect.onStop = () => {
            arrangeExecutionStats.activeValueBindings--
            this.stopped = true
            this.job.flags = (this.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
        }
        this.effect.scheduler = () => queueJob(this.job)
        try { this.effect.run() } catch (error) {
            this.stop()
            throw error
        }
    }

    refresh(expression: ValueExpression, write: (value: unknown, previous: unknown) => void): void {
        const sameRead = this.read === expression.read
        this.read = expression.read
        this.source = expression.source
        this.write = write
        // keyed 移动后闭包可能捕获新 item/index，即使 Ref 没变也必须重订阅
        callWithErrorHandling(() => sameRead ? this.effect.runIfDirty() : this.effect.run(), this.job.i, ErrorCodes.ARRANGABLE_UPDATE)
    }

    currentValue(): unknown { return this.value }

    private annotate(error: unknown): unknown {
        if (error instanceof Error && this.source && !error.message.includes(this.source)) error.message += `\n来源：${this.source}`
        return error
    }

    stop(): void {
        this.effect.stop()
        if (this.scope?.active) {
            const index = this.scope.effects.indexOf(this.effect)
            if (index >= 0) this.scope.effects.splice(index, 1)
        }
    }
}
