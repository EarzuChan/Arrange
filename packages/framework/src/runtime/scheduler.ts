import { type ArrangableInstance, getArrangableName } from './arrangable.ts'
import { ErrorCodes, callWithErrorHandling } from './errorHandling.ts'

export enum SchedulerJobFlags { DISPOSED = 1 }
export type JobPhase = 'pre' | 'collect' | 'rearrange' | 'post'

export interface SchedulerJob {
    (): void
    flags?: SchedulerJobFlags
    i?: ArrangableInstance
    scheduler?: FrameScheduler
    phase?: JobPhase
}

export interface FrameParticipant {
    sample(time: number): void
    active(): boolean
}

const resolved = Promise.resolve()

export function nextTick(): Promise<void>
export function nextTick<T, R>(this: T, fn: (this: T) => R | Promise<R>): Promise<R>
export function nextTick<T, R>(this: T, fn?: (this: T) => R | Promise<R>): Promise<void | R> {
    return fn ? resolved.then(this ? fn.bind(this) : fn) : resolved
}

// 一个 App 的视觉任务只有宿主帧入口可推进，普通 Promise 不获得视觉执行权限
export class FrameScheduler {
    private readonly queues: Record<JobPhase, Set<SchedulerJob>> = { pre: new Set(), collect: new Set(), rearrange: new Set(), post: new Set() }
    private readonly participants = new Set<FrameParticipant>()
    private phase: 'idle' | 'animation' | 'values' | 'awaiting' | 'commit' | 'disposed' = 'idle'
    private timestamp = 0
    private valid = true
    private executeCurrent: ((job: SchedulerJob) => void) | undefined
    private readonly deferred = new Set<SchedulerJob>()
    readonly counters = { frames: 0, jobs: 0, animationSamples: 0, commits: 0 }

    constructor(private readonly request: (pending: boolean) => void, private readonly semanticTime?: () => number) { }

    now(): number { return this.phase === 'animation' || this.phase === 'values' ? this.timestamp : Math.max(this.timestamp, this.semanticTime?.() ?? this.timestamp) }
    get hasPreWork(): boolean { return this.queues.pre.size > 0 }

    drainPre(): void {
        if (!this.executeCurrent) throw new Error('前置观察只能在视觉准备阶段执行')
        while (this.queues.pre.size) {
            const job = this.queues.pre.values().next().value!
            this.queues.pre.delete(job)
            this.executeCurrent(job)
        }
    }

    enqueue(job: SchedulerJob, phase: JobPhase): void {
        if (this.phase === 'disposed' || job.flags! & SchedulerJobFlags.DISPOSED) return
        job.phase = phase
        if (this.phase === 'commit' || this.phase === 'awaiting') this.deferred.add(job)
        else this.queues[phase].add(job)
        if (this.phase === 'idle' || this.phase === 'awaiting' || this.phase === 'commit') this.request(true)
    }

    add(participant: FrameParticipant): void {
        if (this.phase === 'disposed') throw new Error('不能向已销毁的调度器注册动画')
        this.participants.add(participant)
        this.request(true)
    }

    private synchronizeRequest(): void {
        for (const queue of Object.values(this.queues)) for (const job of queue) if (job.flags! & SchedulerJobFlags.DISPOSED || job.i?.isUnmounted) queue.delete(job)
        this.request(this.phase !== 'disposed' && (Object.values(this.queues).some(queue => queue.size) || this.deferred.size > 0 || [...this.participants].some(participant => participant.active())))
    }

    remove(participant: FrameParticipant): void {
        this.participants.delete(participant)
        if (this.phase === 'idle') this.synchronizeRequest()
    }
    wake(): void { if (this.phase !== 'disposed') this.request(true) }
    refresh(): void { if (this.phase === 'idle') this.synchronizeRequest() }
    reject(): void { this.valid = false }

    prepare = (time: number): void => {
        if (this.phase === 'disposed') return
        if (this.phase !== 'idle') throw new Error('视觉帧不能重入')
        if (!Number.isFinite(time) || time < this.timestamp) throw new Error('视觉帧时间必须有限且单调')
        this.timestamp = time
        this.valid = true
        this.counters.frames++
        const executions = new Map<SchedulerJob, number>()
        let count = 0
        const execute = (job: SchedulerJob) => {
            if (job.flags! & SchedulerJobFlags.DISPOSED || job.i?.isUnmounted || job.i?.isDeactivated) return
            const visits = (executions.get(job) ?? 0) + 1
            executions.set(job, visits)
            if (++count > 10000 || visits > 100) throw new Error(`响应式任务反复失效，超过帧内执行上限：${job.i ? getArrangableName(job.i.type) ?? '匿名定义' : 'App'}`)
            this.counters.jobs++
            callWithErrorHandling(job, job.i, job.i ? ErrorCodes.ARRANGABLE_UPDATE : ErrorCodes.SCHEDULER)
        }

        this.executeCurrent = execute
        try {
            this.phase = 'animation'
            for (const participant of [...this.participants]) if (this.participants.has(participant) && participant.active()) {
                this.counters.animationSamples++
                participant.sample(time)
            }

            this.phase = 'values'
            while (this.queues.pre.size || this.queues.collect.size || this.queues.rearrange.size) {
                const phase = this.queues.pre.size ? 'pre' : this.queues.collect.size ? 'collect' : 'rearrange'
                const job = this.queues[phase].values().next().value!
                this.queues[phase].delete(job)
                execute(job)
            }
        } finally {
            this.executeCurrent = undefined
            this.phase = 'idle'
        }
        this.phase = 'awaiting'
        if ([...this.participants].some(participant => participant.active())) this.request(true)
    }

    // 提交后观察只处理已截取的一批，通知引出的失效全部留到下一帧
    complete = (success = true): void => {
        if (this.phase === 'disposed') return
        if (this.phase !== 'awaiting' && this.phase !== 'idle') throw new Error('提交通知不能重入视觉帧')
        this.phase = 'commit'
        success = success && this.valid
        this.counters.commits += Number(success)
        const jobs = [...this.queues.post]
        this.queues.post.clear()
        try {
            if (success) for (const job of jobs) if (!(job.flags! & SchedulerJobFlags.DISPOSED) && !job.i?.isUnmounted && !job.i?.isDeactivated) callWithErrorHandling(job, job.i, ErrorCodes.SCHEDULER)
        } finally {
            this.phase = 'idle'
            for (const job of this.deferred) this.enqueue(job, job.phase ?? 'collect')
            this.deferred.clear()
            this.synchronizeRequest()
        }
    }

    dispose(): void {
        this.phase = 'disposed'
        for (const queue of Object.values(this.queues)) queue.clear()
        this.deferred.clear()
        this.participants.clear()
        this.request(false)
    }
}

// 没有 Arrangable 所属作用域的观察者属于普通语义任务
const semanticJobs = new Set<SchedulerJob>()
let semanticPending = false

function enqueue(job: SchedulerJob, phase: JobPhase): void {
    const scheduler = job.scheduler ?? job.i?.rearrangeSession.scheduler
    if (scheduler) return scheduler.enqueue(job, phase)
    semanticJobs.add(job)
    if (semanticPending) return
    semanticPending = true
    resolved.then(() => {
        let count = 0
        try {
            while (semanticJobs.size) {
                if (++count > 10000) throw new Error('语义任务反复失效，超过微任务检查点上限')
                const next = semanticJobs.values().next().value!
                semanticJobs.delete(next)
                if (!(next.flags! & SchedulerJobFlags.DISPOSED)) callWithErrorHandling(next, undefined, ErrorCodes.SCHEDULER)
            }
        } finally {
            semanticJobs.clear()
            semanticPending = false
        }
    })
}

export function queueJob(job: SchedulerJob): void { enqueue(job, job.phase ?? 'collect') }
export function queueRearrangeJob(job: SchedulerJob): void { enqueue(job, 'rearrange') }
export function queuePostFlushCb(job: SchedulerJob): void { enqueue(job, 'post') }
