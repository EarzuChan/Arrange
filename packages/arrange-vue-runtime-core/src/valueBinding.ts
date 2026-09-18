import { computed, type EffectScope, pauseTracking, ReactiveEffect, resetTracking } from '@arrange/vue-reactivity'
import { isReservedProp } from '@arrange/vue-shared'
import type { ComponentInternalInstance } from './component.ts'
import { callWithErrorHandling, ErrorCodes } from './errorHandling.ts'
import { arrangeExecutionStats } from './executionStats.ts'
import { queueJob, type SchedulerJob, SchedulerJobFlags } from './scheduler.ts'

const measureNow = () => (performance as Performance & { measureNow?: () => number }).measureNow?.() ?? performance.now()

const valueExpression = Symbol('Arrange value expression')
export const textBindingKey = Symbol('Arrange text content')

export interface ValueExpression<T = unknown> {
    readonly [valueExpression]: true
    readonly read: () => T
    readonly source?: string
}

// 编译器把普通模板表达式延后；用户的 Ref 本身不携带用途或阶段
export function arrangeValue<T>(read: () => T, source?: string): ValueExpression<T> {
    return { [valueExpression]: true, read, source }
}

export function isValueExpression(value: unknown): value is ValueExpression {
    return !!value && typeof value === 'object' && valueExpression in value
}

// spread 的键集合与 key/ref 属于结构，普通字段仍在值域读取
// shape computed 复用相等结果，值变化只会唤醒实际字段消费者
export function arrangeProps(read: () => Record<string, unknown> | null | undefined): Record<string, unknown> {
    const values = computed(() => ({ ...read() }))
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
    return Object.fromEntries(keys.map(key => [key, isReservedProp(key) ? reserved[reservedIndex++] : arrangeValue(() => values.value[key])]))
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
        owner: ComponentInternalInstance | null,
        private write: (value: unknown, previous: unknown) => void,
    ) {
        this.read = expression.read
        this.source = expression.source
        this.scope = owner?.scope
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
            if (!this.stopped) callWithErrorHandling(() => this.effect.runIfDirty(), owner, ErrorCodes.COMPONENT_UPDATE)
        }
        // 同一组件结构先处理，已删除分支的绑定在执行前被停止
        this.job.id = owner ? owner.uid + 0.5 : Infinity
        this.job.i = owner ?? undefined
        arrangeExecutionStats.activeValueBindings++
        this.effect.onStop = () => {
            arrangeExecutionStats.activeValueBindings--
            this.stopped = true
            this.job.flags = (this.job.flags ?? 0) | SchedulerJobFlags.DISPOSED
        }
        this.effect.scheduler = () => queueJob(this.job)
        callWithErrorHandling(() => this.effect.run(), owner, ErrorCodes.COMPONENT_UPDATE)
    }

    refresh(expression: ValueExpression, write: (value: unknown, previous: unknown) => void): void {
        this.read = expression.read
        this.source = expression.source
        this.write = write
        // keyed 移动后闭包可能捕获新 item/index，即使 Ref 没变也必须重订阅
        callWithErrorHandling(() => this.effect.run(), this.job.i, ErrorCodes.COMPONENT_UPDATE)
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
