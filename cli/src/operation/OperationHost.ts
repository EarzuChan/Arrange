import { fork, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { operationWaitMs } from "../CliMetadata.ts"
import type { ProcessResult, ProcessSpec, RunningProcess } from "../platform/ProcessSpec.ts"
import { UserDirectories } from "../user/UserDirectories.ts"
import type { WorkerRequest, WorkerResponse } from "./Protocol.ts"
import type { Resource } from "./Resource.ts"

interface Pending {
    resolve(value?: ProcessResult): void
    reject(error: Error): void
    output?: ProcessSpec["onOutput"]
    waiting?: (message: string) => void
}

export interface AcquisitionOptions {
    readonly observe?: boolean
    // null 表示只响应取消，不设等待期限
    readonly timeoutMs?: number | null
}

export class OperationHost {
    private worker: ChildProcess | undefined
    private opening: Promise<void> | undefined
    private readonly pending = new Map<string, Pending>()
    private readonly failure = new AbortController()
    private closing = false

    get failureSignal(): AbortSignal { return this.failure.signal }

    constructor(private readonly directories: UserDirectories) { }

    private async open(): Promise<void> {
        this.opening ??= this.openWorker()
        await this.opening
    }

    private async openWorker(): Promise<void> {
        await this.directories.ensure(this.directories.operations)
        const filename = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./Worker.ts" : "./Worker.js", import.meta.url))
        const worker = fork(filename, [this.directories.operations, randomUUID(), String(process.pid)], { stdio: ["ignore", "ignore", "pipe", "ipc"], detached: process.platform !== "win32", execArgv: filename.endsWith(".ts") ? ["--import", import.meta.resolve("tsx")] : [] })
        this.worker = worker
        let diagnostic = ""
        worker.stderr?.on("data", (bytes: Buffer) => { diagnostic = (diagnostic + bytes.toString("utf8")).slice(-4000) })
        await new Promise<void>((resolve, reject) => {
            let ready = false
            worker.on("message", message => {
                const response = message as WorkerResponse
                if (response.kind === "ready") {
                    ready = true
                    resolve()
                    return
                }
                this.receive(response)
            })
            worker.once("error", reject)
            worker.once("exit", code => {
                const error = new Error(`资源工作进程退出（${code}）${diagnostic ? `：${diagnostic}` : ""}`)
                if (!this.closing) this.failure.abort(error)
                if (!ready) reject(error)
                for (const request of this.pending.values()) request.reject(error)
                this.pending.clear()
                this.worker = undefined
            })
        })
    }

    private receive(response: Exclude<WorkerResponse, { kind: "ready" }>): void {
        const request = this.pending.get(response.id)
        if (!request) return
        if (response.kind === "waiting") request.waiting?.(response.message)
        else if (response.kind === "output") request.output?.(Buffer.from(response.bytes, "base64"), response.channel)
        else {
            this.pending.delete(response.id)
            if (response.kind === "error") {
                const error = new Error(response.message)
                error.name = response.name
                request.reject(error)
            }
            else request.resolve(response.kind === "result" ? response.result : undefined)
        }
    }

    private send(message: WorkerRequest): void {
        if (!this.worker?.connected) throw new Error("资源工作进程未连接")
        this.worker.send(message, error => {
            if (error) {
                this.pending.get(message.id)?.reject(error)
                this.pending.delete(message.id)
            }
        })
    }

    private async request(message: WorkerRequest, callbacks: Pick<Pending, "output" | "waiting"> = {}): Promise<ProcessResult | undefined> {
        await this.open()
        return new Promise((resolve, reject) => {
            this.pending.set(message.id, { resolve, reject, ...callbacks })
            this.send(message)
        })
    }

    async acquire(resources: readonly Resource[], label: string, signal: AbortSignal, waiting: (message: string) => void, options: AcquisitionOptions = {}): Promise<() => Promise<void>> {
        signal.throwIfAborted()
        await this.open()
        signal.throwIfAborted()
        const id = randomUUID()
        const cancel = (): void => { if (this.worker?.connected) this.send({ kind: "cancel", id }) }
        let timedOut = false
        const timeoutMs = options.timeoutMs === undefined ? operationWaitMs : options.timeoutMs
        const timeout = timeoutMs === null ? undefined : setTimeout(() => {
            timedOut = true
            cancel()
        }, timeoutMs)
        signal.addEventListener("abort", cancel, { once: true })
        try {
            const pending = this.request({ kind: "acquire", id, label, resources, observe: options.observe ?? false }, { waiting })
            if (signal.aborted) cancel()
            await pending
            if (signal.aborted) {
                await this.request({ kind: "release", id })
                signal.throwIfAborted()
            }
            return async () => { await this.request({ kind: "release", id }) }
        } catch (error) {
            if (timedOut && timeoutMs !== null) throw new Error(`等待资源超过 ${timeoutMs / 60000} 分钟：${label}`)
            if (signal.aborted) throw new DOMException("操作已取消", "AbortError")
            throw error
        } finally {
            clearTimeout(timeout)
            signal.removeEventListener("abort", cancel)
        }
    }

    start(spec: ProcessSpec): RunningProcess {
        const id = randomUUID()
        const { signal: requestedSignal, onOutput, onOutputEnd, ...process } = spec
        const stopped = new AbortController()
        const signal = requestedSignal ? AbortSignal.any([requestedSignal, stopped.signal]) : stopped.signal
        const cancel = (): void => { if (this.worker?.connected) this.send({ kind: "cancel", id }) }
        signal?.addEventListener("abort", cancel, { once: true })
        const completion = (async () => {
            await this.open()
            if (signal?.aborted) return { exitCode: 130, stdout: "", stderr: "", cancelled: true, timedOut: false }
            const result = await this.request({ kind: "start", id, process }, {
                output: (bytes, channel) => {
                    if (spec.stdio === "inherit") (channel === "stdout" ? globalThis.process.stdout : globalThis.process.stderr).write(bytes)
                    onOutput?.(bytes, channel)
                }
            })
            return result!
        })().finally(() => {
            signal?.removeEventListener("abort", cancel)
            onOutputEnd?.()
        })
        return {
            pid: undefined, completion, stop: async () => {
                stopped.abort()
                await completion
            }
        }
    }

    async close(): Promise<void> {
        if (!this.opening) return
        await this.opening
        if (!this.worker) return
        const worker = this.worker
        this.closing = true
        try { await this.request({ kind: "close", id: randomUUID() }) } catch (error) {
            if (worker.connected) worker.disconnect()
            throw error
        }
        await new Promise<void>(resolve => { if (worker.exitCode !== null) resolve(); else worker.once("exit", () => resolve()) })
    }
}
