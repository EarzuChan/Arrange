import type { SessionDocument, TaskContent, TaskState } from './SessionDocument.ts'
import type { TaskGroup, TaskPresentation, TaskView } from './Presentation.ts'
import { ConsoleBuffer } from './ConsoleBuffer.ts'

export class TaskController implements TaskView {
    private readonly pending = new Set<Promise<void>>()
    private readonly openTasks = new Set<TaskPresentation>()
    constructor(private readonly document: SessionDocument, private readonly changed: () => void, private readonly assertCanOpen: () => void = () => { }) { }
    group(title: string, options?: { readonly transient?: boolean }, document = this.document): TaskGroup {
        this.assertCanOpen()
        document.assertActive()
        const batch = document.batch(title, options?.transient)
        let closed = false
        this.changed()
        return Object.freeze({
            task: (title: string, detail?: string) => {
                if (closed) throw new Error('任务批次已结束')
                const handle = this.handle(document.task(batch, title, detail), document)
                this.changed()
                return handle
            },
            complete: () => {
                if (closed) return
                document.assertActive()
                if (batch.tasks.some(task => task.state === 'running' || task.state === 'pending')) throw new Error('任务尚未全部结束')
                closed = true
                batch.state = batch.tasks.some(task => task.state === 'failed') ? 'failed' : batch.tasks.some(task => task.state === 'cancelled') ? 'cancelled' : 'done'
                this.changed()
            }
        })
    }
    private handle(task: TaskContent, document: SessionDocument): TaskPresentation {
        let parser: ConsoleBuffer | undefined
        let finished: Promise<void> | undefined
        const active = () => {
            document.assertActive()
            if (finished) throw new Error('任务呈现已结束')
        }
        const handle: TaskPresentation = Object.freeze({
            start: () => {
                active()
                if (task.state !== 'pending') throw new Error('任务不能重复开始')
                task.state = 'running'
                this.changed()
            },
            waiting: (text?: string) => {
                active()
                task.waiting = text
                this.changed()
            },
            stage: (text?: string) => {
                active()
                task.stage = text
                this.changed()
            },
            progress: (value: number) => {
                active()
                if (!Number.isFinite(value)) throw new RangeError('任务进度必须为有限数值')
                task.progress = Math.max(0, Math.min(1, value))
                this.changed()
            },
            note: (text: string) => {
                active()
                task.note = text
                this.changed()
            },
            console: (data: string) => {
                active()
                task.console ??= { lines: [], started: true }
                parser ??= new ConsoleBuffer(lines => {
                    task.console!.lines = lines
                    this.changed()
                })
                if (data) parser.write(data)
                this.changed()
            },
            log: (path: string) => {
                document.assertActive()
                if (task.state === 'running' || task.state === 'pending') throw new Error('子控制台结束后才能报告已保存的日志')
                task.logPath = path
                this.changed()
            },
            finish: (state: Exclude<TaskState, 'pending' | 'running'>, detail?: string) => {
                if (finished) return finished
                finished = (async () => {
                    try { await parser?.finish() }
                    finally {
                        parser = undefined
                        task.waiting = undefined
                        task.state = state
                        if (state === 'done') task.progress = 1
                        if (state === 'failed') task.failure = detail
                        else if (detail) task.note = detail
                        this.changed()
                    }
                })()
                this.pending.add(finished)
                const release = () => {
                    this.pending.delete(finished!)
                    this.openTasks.delete(handle)
                }
                void finished.then(release, release)
                return finished
            }
        })
        this.openTasks.add(handle)
        return handle
    }
    async flush(): Promise<void> { await Promise.all(this.pending) }
    async close(state: 'failed' | 'cancelled'): Promise<void> {
        const results = await Promise.allSettled([...this.openTasks].map(task => task.finish(state)))
        for (const entry of this.document.contents()) if (entry.type === 'batch' && entry.state === 'running') {
            entry.state = entry.tasks.some(task => task.state === 'failed') ? 'failed' : 'cancelled'
        }
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), '控制台解析资源释放失败')
    }
}
