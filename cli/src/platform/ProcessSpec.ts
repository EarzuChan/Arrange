export interface ProcessSpec {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
    readonly stdio?: "capture" | "inherit"
    readonly onStdout?: (text: string) => void
    readonly onStderr?: (text: string) => void
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
