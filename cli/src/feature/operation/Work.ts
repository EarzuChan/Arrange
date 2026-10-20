import type { ProcessSpec } from "../platform/ProcessSpec.ts"
import { errorMessage } from "../../util/Utils.ts"
export type WorkTone = "info" | "success" | "warn" | "error"

// 功能执行的进展契约，不依赖终端、视口或任何呈现类型

export interface TaskSpec {
    // ASCII 标识，用于日志文件名
    readonly id: string
    readonly title: string
    readonly detail?: string
    // 工程根；需要保存非成功子控制台输出时用于定位 .arrange/logs
    readonly rootDir?: string
}

// line 为去掉颜色后的纯文本
export type OutputParser = (line: string, task: TaskOutput) => void

export interface TaskOutput {
    readonly title: string
    line(text: string): void
    // 当前任务等待外部资源时显示临时状态，传入 undefined 清除
    waiting(text?: string): void
    stage(text: string | undefined): void
    progress(done: number, total: number): void
    // 把子进程输出接到本任务：捕获 stdout/stderr、逐行解码、保留颜色
    process(spec: ProcessSpec, parser?: OutputParser): ProcessSpec
}

export interface ProcessProgress extends TaskOutput {
    status(text: string, tone: WorkTone): void
    finish(outcome: ProcessOutcome): Promise<void>
}

export type ProcessOutcome =
    | { readonly kind: "stopped", readonly reason: 'user' | 'companion' }
    | { readonly kind: "cancelled" }
    | { readonly kind: "exited", readonly message: string }
    | { readonly kind: "failed", readonly message: string }

export interface ProcessProgressGroup {
    open(spec: TaskSpec): Promise<ProcessProgress>
    // 等待所有进程的进展输出收尾
    close(outcome: ProcessOutcome): Promise<void>
}

export interface TaskEntry<T = unknown> {
    readonly spec: TaskSpec
    readonly run: (task: TaskOutput) => Promise<T>
}

export interface TaskRunner {
    run<T>(spec: TaskSpec, body: (task: TaskOutput) => Promise<T>): Promise<T>
    // 并行运行：一个失败时其余继续跑完，最后一起报告失败（gradle 语义）；取消则全部停止
    all(entries: readonly TaskEntry[]): Promise<unknown[]>
    // 扫描、探测等无需日志的等待阶段
    status<T>(title: string, body: () => Promise<T>): Promise<T>
    processes(): ProcessProgressGroup
}

export class TaskFailures extends Error {
    constructor(readonly failures: readonly { readonly title: string, readonly error: unknown }[]) {
        super(failures.map(failure => `${failure.title}：${errorMessage(failure.error)}`).join("；"))
        this.name = "TaskFailures"
    }
}

// ninja 的状态行：[完成数/总数] 描述
export const ninjaProgress: OutputParser = (line, task) => {
    const match = /^\[(\d+)\/(\d+)\]/.exec(line)
    if (match) task.progress(Number(match[1]), Number(match[2]))
}
