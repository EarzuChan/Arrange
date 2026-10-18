import type { TaskDefinition, TaskGroup, TaskPresentation } from './api.ts'
import type { SessionDocument, TaskContent } from './document.ts'

// 任务句柄只接收呈现事实，不暴露文档、视口和执行资源
export class TaskController {
    private readonly document: SessionDocument
    private readonly invalidate: () => void
    private readonly assertActive: () => void

    constructor(document: SessionDocument, invalidate: () => void, assertActive: () => void) {
        this.document = document
        this.invalidate = invalidate
        this.assertActive = assertActive
    }

    open(title: string, definitions: readonly TaskDefinition[]): TaskGroup {
        this.assertActive()
        if (new Set(definitions.map(task => task.id)).size !== definitions.length) throw new Error('同批任务标识不能重复')

        const batch = this.document.batch(title, definitions)
        const handles = new Map(definitions.map((definition, index) => [definition.id, this.#handle(batch.tasks[index])]))
        this.invalidate()
        let completed = false

        return Object.freeze({
            task(id: string): TaskPresentation {
                const handle = handles.get(id)
                if (!handle) throw new Error(`任务不存在：${id}`)
                return handle
            },
            complete: () => {
                this.assertActive()
                if (completed) return
                if (batch.tasks.some(task => task.state !== 'done')) throw new Error('任务尚未全部完成')
                completed = true
                batch.state = 'done'
                this.invalidate()
            },
        })
    }

    #handle(task: TaskContent): TaskPresentation {
        const mutate = (action: () => void) => {
            this.assertActive()
            action()
            this.invalidate()
        }
        const assertRunning = () => { if (task.state !== 'running') throw new Error('任务必须先开始执行') }
        return Object.freeze({
            start: () => mutate(() => {
                if (task.state !== 'pending') throw new Error('任务不能重复开始')
                task.state = 'running'
                task.consoleStarted = !!task.console
            }),
            progress: (value: number) => mutate(() => {
                assertRunning()
                if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('任务进度必须在 0 到 1 之间')
                task.progress = value
            }),
            append: (lines: readonly string[]) => mutate(() => {
                assertRunning()
                if (!task.console) throw new Error('该任务未声明子控制台')

                task.console.lines.push(...lines)
            }),
            complete: () => mutate(() => {
                assertRunning()
                task.progress = 1
                task.state = 'done'
            }),
        })
    }
}
