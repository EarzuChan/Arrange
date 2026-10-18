import type { TaskDefinition } from './api.ts'

export type TaskState = 'pending' | 'running' | 'done' | 'cancelled'
export interface ConsoleContent { lines: string[] }
export interface TaskContent { id: string, title: string, state: TaskState, progress: number, console?: ConsoleContent, consoleStarted: boolean }
export interface BatchContent { type: 'batch', title: string, state: TaskState, tasks: TaskContent[] }
export interface PromptContent { kind: 'text' | 'select' | 'multi', question: string, options: string[], cursor: number, selected: number[], value: string, placeholder: string }
export type Entry = { type: 'heading' | 'message' | 'result', text: string } | { type: 'answer', question: string, answer: string } | BatchContent

// 文档只保存可呈现内容，业务流程和任务执行生命周期由调用方拥有
export class SessionDocument {
    entries: Entry[] = []
    prompt: PromptContent | null = null
    phase: 'active' | 'done' | 'cancelled' | 'failed' = 'active'
    #nextTask = 0

    batch(title: string, definitions: readonly TaskDefinition[]): BatchContent {
        const batch: BatchContent = { type: 'batch', title, state: 'running', tasks: definitions.map(definition => ({ id: `console-${++this.#nextTask}`, title: definition.title, state: 'pending', progress: 0, consoleStarted: false, ...(definition.console ? { console: { lines: [] } } : {}) })) }
        this.entries.push(batch)
        return batch
    }

    cancel(): void {
        if (this.phase !== 'active') return
        if (this.prompt) this.entries.push({ type: 'answer', question: this.prompt.question, answer: '已取消' })
        this.prompt = null
        for (const entry of this.entries) if (entry.type === 'batch' && entry.state === 'running') {
            entry.state = 'cancelled'
            for (const task of entry.tasks) if (task.state !== 'done') task.state = 'cancelled'
        }
        this.entries.push({ type: 'result', text: '操作已取消' })
        this.phase = 'cancelled'
    }
}
