import type { ProcessSpec } from "../platform/ProcessSpec.ts"
import { errorMessage } from "../util/Utils.ts"
import type { Tone } from "./TaskBoard.ts"

// 服务层看到的任务接口：服务只负责产生日志行、阶段与进度，如何呈现由界面层决定

export interface TaskSpec {
    // ASCII 标识，用于日志文件名
    readonly id: string
    readonly title: string
    readonly detail?: string
    // 工程根；提供时任务日志写入 .arrange/logs
    readonly rootDir?: string
}

// line 为去掉颜色后的纯文本
export type OutputParser = (line: string, task: TaskOutput) => void

export interface TaskOutput {
    readonly title: string
    line(text: string): void
    stage(text: string | undefined): void
    progress(done: number, total: number): void
    // 把子进程输出接到本任务：捕获 stdout/stderr、逐行解码、保留颜色
    process(spec: ProcessSpec, parser?: OutputParser): ProcessSpec
}

export interface PaneOutput extends TaskOutput {
    status(text: string, tone: Tone): void
    finish(outcome: PaneOutcome): void
}

export type PaneOutcome =
    | { readonly kind: "stopped" }
    | { readonly kind: "exited", readonly message: string }
    | { readonly kind: "failed", readonly message: string }

export interface PaneSession {
    open(spec: TaskSpec): Promise<PaneOutput>
    // 结束会话，把各窗格的结果写进滚动历史
    close(): Promise<void>
}

export interface TaskEntry<T = unknown> {
    readonly spec: TaskSpec
    readonly run: (task: TaskOutput) => Promise<T>
}

export interface TaskRunner {
    run<T>(spec: TaskSpec, body: (task: TaskOutput) => Promise<T>): Promise<T>
    // 并行运行：一个失败时其余继续跑完，最后一起报告失败（gradle 语义）；取消则全部停止
    all(entries: readonly TaskEntry[]): Promise<unknown[]>
    // 临时状态：执行期间显示一行转圈与用时，结束后不留痕（用于扫描、探测等没有日志的等待）
    status<T>(title: string, body: () => Promise<T>): Promise<T>
    panes(): PaneSession
}

export class TaskFailures extends Error {
    constructor(readonly failures: readonly { readonly title: string, readonly error: unknown }[]) {
        super(failures.map(failure => `${failure.title}：${errorMessage(failure.error)}`).join("；"))
        this.name = "TaskFailures"
    }
}

// 子进程输出不是终端时多数工具会关闭颜色；用户未要求禁用颜色时强制打开
export function colorEnvironment(): Record<string, string> {
    if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return {}
    return { FORCE_COLOR: "1", CLICOLOR_FORCE: "1" }
}

// ninja 的状态行：[完成数/总数] 描述
export const ninjaProgress: OutputParser = (line, task) => {
    const match = /^\[(\d+)\/(\d+)\]/.exec(line)
    if (match) task.progress(Number(match[1]), Number(match[2]))
}
