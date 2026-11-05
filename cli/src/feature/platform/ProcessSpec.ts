export interface ProcessSpec {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
    // 捕获模式下收到的原始字节；解码由调用方负责（原生工具可能不是 UTF-8）
    readonly onOutput?: (chunk: Buffer, stream: "stdout" | "stderr") => void
    // 两条输出流都已关闭
    readonly onOutputEnd?: () => void
    // 为 false 时不在结果里累积 stdout/stderr，供长时间、大量输出的任务使用
    readonly retainOutput?: boolean
    readonly windowsVerbatimArguments?: boolean
    // 任务结束后进程树的清理结论不是 clean 时通知调用方；任务本身的结果不受影响
    readonly onCleanup?: (verdict: CleanupVerdict) => void
}

// clean：确认没有残留；reaped：发现后代并已结束；unknown：无法确认，资源占用必须保留
export type CleanupVerdict = "clean" | "reaped" | "unknown"

export interface ProcessResult {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly signal?: NodeJS.Signals
    readonly cancelled: boolean
    readonly timedOut: boolean
    // 由持有进程树的一方在清理后补充
    readonly cleanup?: CleanupVerdict
}

export interface RunningProcess {
    readonly pid: number | undefined
    readonly completion: Promise<ProcessResult>
    // 结论为 unknown 时不抛错，可再次调用重试；只有无法执行清理动作本身才拒绝
    stop(signal?: NodeJS.Signals): Promise<CleanupVerdict>
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError"
}

export function throwIfProcessCancelled(result: ProcessResult): void {
    if (result.cancelled) throw new DOMException("操作已取消", "AbortError")
}
