import { spawn } from "node:child_process"
import { join } from "node:path"
import { processStopGraceMs } from "../CliMetadata.ts"
import type { ProcessResult, ProcessSpec, RunningProcess } from "./ProcessSpec.ts"

export function quoteWindowsArgument(value: string): string {
    if (/[\r\n\0%\"]/.test(value)) throw new Error("Windows 批处理参数不支持换行、NUL、百分号或双引号")
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
}

export class Executor {
    constructor(private readonly executionPlatform: NodeJS.Platform = process.platform, private readonly defaultSignal?: AbortSignal) { }

    async run(spec: ProcessSpec): Promise<ProcessResult> {
        return this.start(spec).completion
    }

    start(spec: ProcessSpec): RunningProcess {
        const signal = spec.signal ?? this.defaultSignal
        if (signal?.aborted) return { pid: undefined, completion: Promise.resolve({ exitCode: 130, stdout: "", stderr: "", cancelled: true, timedOut: false }), stop: async () => { } }
        const batch = this.executionPlatform === "win32" && /\.(cmd|bat)$/i.test(spec.command)
        const command = batch ? process.env.ComSpec ?? "cmd.exe" : spec.command
        const args = batch ? ["/d", "/v:off", "/s", "/c", `"${[spec.command, ...spec.args].map(quoteWindowsArgument).join(" ")}"`] : [...spec.args]
        const env = { ...process.env }
        for (const [key, value] of Object.entries(spec.env ?? {})) {
            if (this.executionPlatform === "win32") for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing]
            env[key] = value
        }
        const startedAt = Date.now()
        const child = spawn(command, args, { cwd: spec.cwd, env, stdio: spec.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"], detached: this.executionPlatform !== "win32", windowsHide: true, windowsVerbatimArguments: batch || spec.windowsVerbatimArguments === true })
        let stdout = ""
        let stderr = ""
        let cancelled = false
        let timedOut = false
        let stopPromise: Promise<void> | undefined
        let exitedAt: number | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let killTimer: ReturnType<typeof setTimeout> | undefined
        let pipeTimer: ReturnType<typeof setTimeout> | undefined
        let failStop: (error: unknown) => void = () => { }
        const completion = new Promise<ProcessResult>((resolve, reject) => {
            child.once("exit", () => {
                exitedAt = Date.now()
                // 孙进程可能继承捕获管道；主进程已退出后不能永远等待它关闭
                if (child.stdout || child.stderr) {
                    pipeTimer = setTimeout(() => { void stop().catch(failStop) }, processStopGraceMs)
                    pipeTimer.unref()
                }
            })
            child.stdout?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8")
                stdout += text
                spec.onStdout?.(text)
            })
            child.stderr?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8")
                stderr += text
                spec.onStderr?.(text)
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
                cleanup()
                reject(error)
            })
            child.once("close", (code, childSignal) => {
                cleanup()
                resolve({ exitCode: cancelled ? 130 : timedOut ? 124 : code ?? (childSignal === "SIGINT" ? 130 : 1), stdout, stderr, ...(childSignal ? { signal: childSignal } : {}), cancelled, timedOut })
            })
        })
        const stop = async (stopSignal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
            if (stopPromise) return stopPromise
            stopPromise = (async () => {
                if (this.executionPlatform === "win32") {
                    if (child.pid) await this.killWindowsTree(child.pid, startedAt, exitedAt)
                } else if (child.pid) {
                    this.signalGroup(child.pid, stopSignal)
                    const pid = child.pid
                    await new Promise<void>((resolve, reject) => {
                        killTimer = setTimeout(() => {
                            try {
                                this.signalGroup(pid, "SIGKILL")
                                resolve()
                            } catch (error) { reject(error) }
                        }, processStopGraceMs)
                        void completion.catch(() => { }).then(() => {
                            try { process.kill(-pid, 0) } catch {
                                clearTimeout(killTimer)
                                resolve()
                            }
                        })
                    })
                }
                let waitTimer: ReturnType<typeof setTimeout> | undefined
                try {
                    await Promise.race([
                        completion.catch(() => { }),
                        new Promise<never>((_, reject) => { waitTimer = setTimeout(() => reject(new Error("子进程未在限定时间内停止")), processStopGraceMs * 2) }),
                    ])
                } finally { clearTimeout(waitTimer) }
            })()
            return stopPromise
        }
        const abort = (): void => {
            cancelled = true
            void stop("SIGINT").catch(failStop)
        }
        signal?.addEventListener("abort", abort, { once: true })
        if (signal?.aborted) abort()
        if (spec.timeoutMs !== undefined) timer = setTimeout(() => {
            timedOut = true
            void stop().catch(failStop)
        }, spec.timeoutMs)
        return { pid: child.pid, completion, stop }
    }

    private signalGroup(pid: number, signal: NodeJS.Signals): void {
        try { process.kill(-pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    }

    private async killWindowsTree(pid: number, startedAt: number, exitedAt?: number): Promise<void> {
        const killed = exitedAt === undefined && await new Promise<boolean>(resolve => {
            const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" })
            const timeout = setTimeout(() => {
                killer.kill()
                resolve(false)
            }, processStopGraceMs * 2)
            killer.once("error", () => {
                clearTimeout(timeout)
                resolve(false)
            })
            killer.once("close", code => {
                clearTimeout(timeout)
                resolve(code === 0)
            })
        })
        if (killed) return
        const cutoff = exitedAt ?? Date.now()
        const script = `
$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$seen=@{}
$pending=[System.Collections.Generic.Queue[uint32]]::new()
foreach($p in $all) {
    if(${exitedAt === undefined ? "$true" : "$false"} -and $p.ProcessId -eq ${pid} -and $p.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime -and $p.CreationDate.ToUniversalTime() -le [DateTimeOffset]::FromUnixTimeMilliseconds(${cutoff}).UtcDateTime) { $pending.Enqueue([uint32]$p.ProcessId) }
    if($p.ParentProcessId -eq ${pid} -and $p.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime -and $p.CreationDate.ToUniversalTime() -le [DateTimeOffset]::FromUnixTimeMilliseconds(${cutoff}).UtcDateTime) { $pending.Enqueue([uint32]$p.ProcessId) }
}
while($pending.Count) {
    $id=$pending.Dequeue()
    if($seen.ContainsKey($id)) { continue }
    $seen[$id]=$true
    foreach($p in $all) { if($p.ParentProcessId -eq $id) { $pending.Enqueue([uint32]$p.ProcessId) } }
    try { Stop-Process -Id $id -Force -ErrorAction Stop }
    catch { if(Get-Process -Id $id -ErrorAction SilentlyContinue) { throw } }
}`
        const command = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe"
        await new Promise<void>((resolve, reject) => {
            const cleaner = spawn(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" })
            const timeout = setTimeout(() => {
                cleaner.kill()
                reject(new Error("Windows 子进程树清理超时"))
            }, processStopGraceMs * 2)
            cleaner.once("error", error => {
                clearTimeout(timeout)
                reject(error)
            })
            cleaner.once("close", code => {
                clearTimeout(timeout)
                if (code === 0) resolve()
                else reject(new Error(`Windows 子进程树清理失败（${code}）`))
            })
        })
    }
}
