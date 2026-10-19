import type { TaskState, Tone } from './SessionDocument.ts'

// 业务侧只提交呈现事实，不取得坐标、输入事件、文档或终端流
export interface TaskPresentation {
    start(): void
    stage(text?: string): void
    progress(value: number): void
    note(text: string, tone?: Tone): void
    console(data: string): void
    // 仅在结束并成功保存文件后提交路径
    log(path: string): void
    finish(state: Exclude<TaskState, 'pending' | 'running'>, detail?: string): Promise<void>
}
export interface TaskGroup {
    task(title: string, detail?: string): TaskPresentation
    complete(): void
}
export interface TaskView { group(title: string, options?: { readonly transient?: boolean }): TaskGroup }
export interface PresentationRegion<T> {
    readonly current: T
    replace(): T
    complete(answer?: { readonly question: string, readonly answer: string }): void
}
