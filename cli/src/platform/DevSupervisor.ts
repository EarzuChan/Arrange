import { devReadinessTimeoutMs } from "../CliMetadata.ts"
import type { Executor } from "./Executor.ts"
import type { ProcessResult, ProcessSpec, RunningProcess } from "./ProcessSpec.ts"
import { isAbortError } from "./ProcessSpec.ts"

export interface LongRunningProcessSpec extends ProcessSpec {
    readonly name: string
    readonly readyUrl?: string
    readonly readyHeader?: { readonly name: string, readonly value: string }
    readonly readyCheck?: (response: Response) => Promise<boolean>
    readonly dependsOn?: readonly string[]
}

export interface DevSupervisorOptions {
    readonly signal?: AbortSignal
    readonly readinessTimeoutMs?: number
}

export class DevSupervisor {
    constructor(private readonly executor: Executor) { }

    async run(processes: readonly LongRunningProcessSpec[], options: DevSupervisorOptions = {}): Promise<number> {
        if (!processes.length) throw new Error("没有需要启动的开发进程")
        const controller = new AbortController()
        const children: { name: string, process: RunningProcess }[] = []
        type ChildExit = { name: string, result: ProcessResult }
        let firstCompleted: ChildExit | undefined
        let resolveExit!: (value: ChildExit) => void
        let rejectExit!: (error: unknown) => void
        const firstExit = new Promise<ChildExit>((resolve, reject) => {
            resolveExit = resolve
            rejectExit = reject
        })
        const interrupt = (): void => controller.abort()
        const abortSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
        const prematureExit = firstExit.then(({ name, result }) => {
            if (result.cancelled && abortSignal.aborted) throw abortSignal.reason
            throw new Error(`${name} 在准备就绪前退出（${result.exitCode}${result.signal ? `，信号 ${result.signal}` : ""}）`)
        })
        void prematureExit.catch(() => { })
        process.on("SIGINT", interrupt)
        process.on("SIGTERM", interrupt)
        try {
            const pending = [...processes]
            const ready = new Set<string>()
            if (new Set(processes.map(spec => spec.name)).size !== processes.length) throw new Error("开发进程名称重复")
            for (const spec of processes) for (const dependency of spec.dependsOn ?? []) if (!processes.some(candidate => candidate.name === dependency)) throw new Error(`开发进程 ${spec.name} 的依赖 ${dependency} 不存在`)
            while (pending.length) {
                if (abortSignal.aborted) return 0
                const index = pending.findIndex(spec => (spec.dependsOn ?? []).every(name => ready.has(name)))
                if (index < 0) throw new Error("开发进程存在循环依赖")
                const spec = pending.splice(index, 1)[0]!
                if (spec.readyUrl && await Promise.race([this.responds(spec.readyUrl, abortSignal), prematureExit])) throw new Error(`开发地址已被占用：${spec.readyUrl}`)
                const child = this.executor.start({ ...spec, signal: abortSignal, stdio: spec.stdio ?? "inherit" })
                children.push({ name: spec.name, process: child })
                void child.completion.then(result => {
                    const exit = { name: spec.name, result }
                    firstCompleted ??= exit
                    resolveExit(exit)
                }, error => rejectExit(new Error(`开发进程 ${spec.name} 执行失败：${String(error)}`, { cause: error })))
                if (spec.readyUrl) await Promise.race([this.waitReady(spec, abortSignal, options.readinessTimeoutMs ?? devReadinessTimeoutMs), prematureExit])
                if (firstCompleted) await prematureExit
                ready.add(spec.name)
            }
            const { name, result } = await firstExit
            if (!abortSignal.aborted && !result.cancelled) console.log("[ArrangeCLI]", `开发进程 ${name} 已退出（退出码 ${result.exitCode}${result.signal ? `，信号 ${result.signal}` : ""}）`)
            return abortSignal.aborted && result.cancelled ? 0 : result.exitCode
        } catch (error) {
            if (abortSignal.aborted && (error === abortSignal.reason || isAbortError(error))) return 0
            throw error
        } finally {
            controller.abort()
            const stopped = await Promise.allSettled(children.map(child => child.process.stop()))
            process.removeListener("SIGINT", interrupt)
            process.removeListener("SIGTERM", interrupt)
            const failure = stopped.find((result): result is PromiseRejectedResult => result.status === "rejected")
            if (failure) throw new Error(`开发进程清理失败：${String(failure.reason)}`)
        }
    }

    private async responds(url: string, signal: AbortSignal): Promise<boolean> {
        try {
            const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })
            await response.body?.cancel()
            return true
        } catch { return false }
    }

    private async waitReady(spec: LongRunningProcessSpec, signal: AbortSignal, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs
        let lastStatus: number | undefined
        let lastMessage = "尚未收到 HTTP 响应"
        while (Date.now() < deadline) {
            signal.throwIfAborted()
            try {
                const response = await fetch(spec.readyUrl!, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })
                lastStatus = response.status
                lastMessage = "未通过就绪校验"
                const matches = response.ok && (!spec.readyHeader || response.headers.get(spec.readyHeader.name) === spec.readyHeader.value) && (!spec.readyCheck || await spec.readyCheck(response))
                if (matches) {
                    if (!response.bodyUsed) await response.body?.cancel()
                    return
                }
                if (!response.bodyUsed) lastMessage = await this.diagnosticLine(response) || lastMessage
            } catch (error) {
                if (signal.aborted) throw error
                lastMessage = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.slice(0, 500)
            }
            await new Promise<void>(resolve => setTimeout(resolve, 100))
        }
        throw new Error(`${spec.name} 未在限定时间内就绪：${spec.readyUrl}；最近响应${lastStatus === undefined ? "" : ` HTTP ${lastStatus}`}：${lastMessage}`)
    }

    private async diagnosticLine(response: Response): Promise<string> {
        if (!response.body) return ""
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = ""
        let bytes = 0
        try {
            // 只读取错误正文首行；单次大块响应也不能让诊断无限增长
            while (text.length < 500 && bytes < 2000 && !/[\r\n]/.test(text)) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = value.subarray(0, 2000 - bytes)
                bytes += chunk.length
                text += decoder.decode(chunk, { stream: true })
            }
            return text.split(/[\r\n]/)[0]!.slice(0, 500)
        } finally { await reader.cancel() }
    }
}
