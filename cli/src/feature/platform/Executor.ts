import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { processStopGraceMs } from "../../CliMetadata.ts"
import { createContainment } from "./Containment.ts"
import type { ProcessContainment } from "./ProcessContainer.ts"
import type { CleanupVerdict, ProcessResult, ProcessSpec, RunningProcess } from "./ProcessSpec.ts"

export function quoteWindowsArgument(value: string): string {
    if (/[\r\n\0%\"]/.test(value)) throw new Error("Windows 批处理参数不支持换行、NUL、百分号或双引号")
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
}

export class Executor {
    constructor(private readonly executionPlatform: NodeJS.Platform = process.platform, private readonly defaultSignal?: AbortSignal, private readonly host?: { start(spec: ProcessSpec): RunningProcess }, private readonly containment: ProcessContainment = createContainment(executionPlatform)) { }

    async run(spec: ProcessSpec): Promise<ProcessResult> {
        return this.start(spec).completion
    }

    start(spec: ProcessSpec): RunningProcess {
        const signal = spec.signal ?? this.defaultSignal
        if (signal?.aborted) return { pid: undefined, completion: Promise.resolve({ exitCode: 130, stdout: "", stderr: "", cancelled: true, timedOut: false }), stop: async () => "clean" }
        if (this.host) return this.host.start({ ...spec, signal })
        const batch = this.executionPlatform === "win32" && /\.(cmd|bat)$/i.test(spec.command)
        const command = batch ? process.env.ComSpec ?? "cmd.exe" : spec.command
        const args = batch ? ["/d", "/v:off", "/s", "/c", `"${[spec.command, ...spec.args].map(quoteWindowsArgument).join(" ")}"`] : [...spec.args]
        const env = { ...process.env }
        for (const [key, value] of Object.entries(spec.env ?? {})) {
            if (this.executionPlatform === "win32") for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing]
            env[key] = value
        }
        const startedAt = Date.now()
        const child = spawn(command, args, { cwd: spec.cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: this.executionPlatform !== "win32", windowsHide: true, windowsVerbatimArguments: batch || spec.windowsVerbatimArguments === true })
        let stdout = ""
        let stderr = ""
        let cancelled = false
        let timedOut = false
        let stopPromise: Promise<CleanupVerdict> | undefined
        let exitedAt: number | undefined
        let closed = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let pipeTimer: ReturnType<typeof setTimeout> | undefined
        let failStop: (error: unknown) => void = () => { }
        // 进程一创建就归入容器，此后产生的后代都由它判定
        const container = child.pid === undefined ? undefined : this.containment.contain(child.pid, { startedAt, exitedAt: () => exitedAt })
        const completion = new Promise<ProcessResult>((resolve, reject) => {
            child.once("exit", () => {
                exitedAt = Date.now()
                // 孙进程可能继承捕获管道；主进程已退出后不能永远等待它关闭
                if (child.stdout || child.stderr) {
                    pipeTimer = setTimeout(() => forceStop(), processStopGraceMs)
                    pipeTimer.unref()
                }
            })
            const retain = spec.retainOutput !== false
            const stdoutDecoder = new StringDecoder("utf8")
            const stderrDecoder = new StringDecoder("utf8")
            child.stdout?.on("data", (chunk: Buffer) => {
                if (retain) stdout += stdoutDecoder.write(chunk)
                spec.onOutput?.(chunk, "stdout")
            })
            child.stderr?.on("data", (chunk: Buffer) => {
                if (retain) stderr += stderrDecoder.write(chunk)
                spec.onOutput?.(chunk, "stderr")
            })
            const cleanup = (): void => {
                if (timer) clearTimeout(timer)
                if (pipeTimer) clearTimeout(pipeTimer)
                signal?.removeEventListener("abort", abort)
            }
            failStop = error => {
                cleanup()
                reject(error)
            }
            child.once("error", error => {
                closed = true
                cleanup()
                reject(error)
            })
            child.once("close", (code, childSignal) => {
                closed = true
                cleanup()
                container?.releaseIfEmpty()
                if (retain) {
                    stdout += stdoutDecoder.end()
                    stderr += stderrDecoder.end()
                }
                try { spec.onOutputEnd?.() } catch (error) {
                    reject(error)
                    return
                }
                resolve({ exitCode: cancelled ? 130 : timedOut ? 124 : code ?? (childSignal === "SIGINT" ? 130 : 1), stdout, stderr, ...(childSignal ? { signal: childSignal } : {}), cancelled, timedOut })
            })
        })
        const reap = async (stopSignal: NodeJS.Signals): Promise<CleanupVerdict> => {
            const verdict = container ? await container.reap(stopSignal, processStopGraceMs) : "clean"
            if (closed) return verdict
            let waitTimer: ReturnType<typeof setTimeout> | undefined
            try {
                const inTime = await Promise.race([
                    completion.then(() => true, () => true),
                    new Promise<boolean>(resolve => { waitTimer = setTimeout(() => resolve(false), processStopGraceMs * 2) }),
                ])
                return inTime ? verdict : "unknown"
            } finally { clearTimeout(waitTimer) }
        }
        const stop = (stopSignal: NodeJS.Signals = "SIGTERM"): Promise<CleanupVerdict> => {
            if (stopPromise) return stopPromise
            const attempt = reap(stopSignal)
            // 未确认或出错的清理允许再次调用重试，已确认的结论固定
            stopPromise = attempt.then(verdict => {
                if (verdict === "unknown") stopPromise = undefined
                return verdict
            }, error => {
                stopPromise = undefined
                throw error
            })
            return stopPromise
        }
        // 内部触发的停止：主进程自身停不下来才让完成结果失败；仅后代未确认由调用方稍后重试
        const forceStop = (stopSignal?: NodeJS.Signals): void => {
            void stop(stopSignal).then(verdict => { if (verdict === "unknown" && !closed) failStop(new Error("子进程未在限定时间内停止")) }, error => { if (!closed) failStop(error) })
        }
        const abort = (): void => {
            cancelled = true
            forceStop("SIGINT")
        }
        signal?.addEventListener("abort", abort, { once: true })
        if (signal?.aborted) abort()
        if (spec.timeoutMs !== undefined) timer = setTimeout(() => {
            timedOut = true
            forceStop()
        }, spec.timeoutMs)
        return { pid: child.pid, completion, stop }
    }
}
