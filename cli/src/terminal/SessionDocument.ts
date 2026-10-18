export type TaskState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'stopped'
export type Tone = 'info' | 'step' | 'success' | 'warn' | 'error'
export interface ConsoleContent { lines: string[], started: boolean }
export interface TaskContent { id: string, title: string, state: TaskState, detail?: string, stage?: string, note?: string, progress?: number, failure?: string, logPath?: string, console?: ConsoleContent }
export interface BatchContent { type: 'batch', title: string, state: TaskState, tasks: TaskContent[], messages?: { text: string, tone?: Tone }[] }
export interface PromptContent { kind: 'text' | 'select' | 'multiselect', question: string, options: string[], index: number, selected: number[], value: string, cursor: number, placeholder: string, error?: string }
export type Entry = { type: 'heading' | 'message' | 'result', text: string, tone?: Tone } | { type: 'answer', question: string, answer: string } | BatchContent

// 仅保存呈现事实，完成的控制台内容与执行资源分别持有
export class SessionDocument {
    readonly entries: Entry[] = []
    phase: 'active' | 'done' | 'failed' | 'cancelled' = 'active'
    private sequence = 0
    answer(question: string, answer: string): void { this.entries.push({ type: 'answer', question, answer }) }
    batch(title: string): BatchContent {
        const batch: BatchContent = { type: 'batch', title, state: 'running', tasks: [] }
        this.entries.push(batch)
        return batch
    }
    task(batch: BatchContent, title: string, detail?: string): TaskContent {
        const task: TaskContent = { id: 'task-' + ++this.sequence, title, detail, state: 'pending' }
        batch.tasks.push(task)
        return task
    }
}
