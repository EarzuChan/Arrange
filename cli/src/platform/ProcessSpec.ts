export interface ProcessSpec {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
    readonly stdio?: "capture" | "inherit"
    // 捕获模式下收到的原始字节；解码由调用方负责（原生工具可能不是 UTF-8）
    readonly onOutput?: (chunk: Buffer, stream: "stdout" | "stderr") => void
    // 两条输出流都已关闭
    readonly onOutputEnd?: () => void
    // 为 false 时不在结果里累积 stdout/stderr，供长时间、大量输出的任务使用
    readonly retainOutput?: boolean
    readonly windowsVerbatimArguments?: boolean
}

export interface ProcessResult {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly signal?: NodeJS.Signals
    readonly cancelled: boolean
    readonly timedOut: boolean
}

export interface RunningProcess {
    readonly pid: number | undefined
    readonly completion: Promise<ProcessResult>
    stop(signal?: NodeJS.Signals): Promise<void>
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError"
}

export function throwIfProcessCancelled(result: ProcessResult): void {
    if (result.cancelled) throw new DOMException("操作已取消", "AbortError")
}
