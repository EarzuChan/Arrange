import { type ArrangableInstance, getArrangableName } from './arrangable.ts'
import { ErrorCodes, callWithErrorHandling } from './errorHandling.ts'

export enum SchedulerJobFlags {
    QUEUED = 1 << 0,
    PRE = 1 << 1,
    ALLOW_RECURSE = 1 << 2,
    DISPOSED = 1 << 3,
}

export interface SchedulerJob {
    (): void
    id?: number
    flags?: SchedulerJobFlags
    i?: ArrangableInstance
}

const queue: SchedulerJob[] = []
const rearrangeQueue = new Set<SchedulerJob>()
const postQueue = new Set<SchedulerJob>()
let flushIndex = -1
const resolvedPromise = Promise.resolve()
let currentFlushPromise: Promise<void> | null = null

export function nextTick(): Promise<void>
export function nextTick<T, R>(this: T, fn: (this: T) => R | Promise<R>): Promise<R>
export function nextTick<T, R>(this: T, fn?: (this: T) => R | Promise<R>): Promise<void | R> {
    const pending = currentFlushPromise ?? resolvedPromise
    return fn ? pending.then(this ? fn.bind(this) : fn) : pending
}

const getId = (job: SchedulerJob): number => job.id ?? (job.flags! & SchedulerJobFlags.PRE ? -1 : Infinity)

// 只在未执行范围内插入，同一所属实例的前置 watcher 先于其消费者收集任务
function findInsertionIndex(id: number): number {
    let start = flushIndex + 1
    let end = queue.length
    while (start < end) {
        const middle = (start + end) >>> 1
        const job = queue[middle]
        if (getId(job) < id || getId(job) === id && job.flags! & SchedulerJobFlags.PRE) start = middle + 1
        else end = middle
    }
    return start
}

function queueFlush(): void {
    currentFlushPromise ??= resolvedPromise.then(flushJobs)
}

export function queueJob(job: SchedulerJob): void {
    if (job.flags! & (SchedulerJobFlags.QUEUED | SchedulerJobFlags.DISPOSED)) return
    const last = queue[queue.length - 1]
    if (!last || !(job.flags! & SchedulerJobFlags.PRE) && getId(job) >= getId(last)) queue.push(job)
    else queue.splice(findInsertionIndex(getId(job)), 0, job)
    job.flags! |= SchedulerJobFlags.QUEUED
    queueFlush()
}

// 收齐本批结构和值失效后才准备候选，不能逐消费者提前 apply
export function queueRearrangeJob(job: SchedulerJob): void {
    if (job.flags! & SchedulerJobFlags.DISPOSED) return
    rearrangeQueue.add(job)
    queueFlush()
}

export function queuePostFlushCb(job: SchedulerJob): void {
    if (job.flags! & (SchedulerJobFlags.QUEUED | SchedulerJobFlags.DISPOSED)) return
    postQueue.add(job)
    job.flags! |= SchedulerJobFlags.QUEUED
    queueFlush()
}

function flushJobs(): void {
    const executions = new Map<SchedulerJob, number>()
    let total = 0
    const execute = (job: SchedulerJob) => {
        if (job.flags! & SchedulerJobFlags.DISPOSED) return
        const count = (executions.get(job) ?? 0) + 1
        executions.set(job, count)
        if (++total > 10000 || count > 100) {
            const name = job.i && getArrangableName(job.i.type)
            throw new Error(`响应式任务反复失效，超过调度执行上限${name ? `：${name}` : ''}`)
        }
        if (job.flags! & SchedulerJobFlags.ALLOW_RECURSE) job.flags! &= ~SchedulerJobFlags.QUEUED
        try { callWithErrorHandling(job, job.i, job.i ? ErrorCodes.ARRANGABLE_UPDATE : ErrorCodes.SCHEDULER) } finally {
            job.flags! &= ~SchedulerJobFlags.QUEUED
        }
    }

    try {
        do {
            for (flushIndex = 0; flushIndex < queue.length; flushIndex++) execute(queue[flushIndex])
            queue.length = 0
            flushIndex = -1

            while (rearrangeQueue.size) {
                const job = rearrangeQueue.values().next().value!
                rearrangeQueue.delete(job)
                execute(job)
            }
            // 重排期间新加入的普通任务先处理，后置 watcher 不越过尚未收集的工作
            if (queue.length) continue
            for (const job of [...postQueue].sort((left, right) => getId(left) - getId(right))) {
                postQueue.delete(job)
                execute(job)
            }
        } while (queue.length || rearrangeQueue.size || postQueue.size)
    } finally {
        for (const job of queue) job.flags! &= ~SchedulerJobFlags.QUEUED
        for (const job of postQueue) job.flags! &= ~SchedulerJobFlags.QUEUED
        queue.length = 0
        rearrangeQueue.clear()
        postQueue.clear()
        flushIndex = -1
        currentFlushPromise = null
    }
}