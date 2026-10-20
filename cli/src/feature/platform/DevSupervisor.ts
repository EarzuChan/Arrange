import { devReadinessTimeoutMs } from "../../CliMetadata.ts"
import type { Executor } from "./Executor.ts"
import type { ProcessResult, ProcessSpec, RunningProcess } from "./ProcessSpec.ts"
import { isAbortError } from "./ProcessSpec.ts"
import type { ProcessOutcome, ProcessProgress, ProcessProgressGroup } from "../operation/Work.ts"
import { errorMessage } from "../../util/Utils.ts"

export interface LongRunningProcessSpec extends ProcessSpec {
    readonly name: string
    readonly title?: string
    readonly detail?: string
    readonly readyUrl?: string
    readonly readyHeader?: { readonly name: string, readonly value: string }
    readonly readyCheck?: (response: Response) => Promise<boolean>
    readonly dependsOn?: readonly string[]
    readonly waitReady?: (signal: AbortSignal) => Promise<void>
    readonly exitPolicy?: 'end-session' | 'service'
}

export interface DevSupervisorOptions {
    readonly signal?: AbortSignal
    readonly readinessTimeoutMs?: number
    readonly stopSignal?: AbortSignal
    readonly onRunning?: () => void
    readonly onStopping?: () => void
    // 调用方提供进展接收方；未提供时通过 ProcessSpec 的 onOutput 接收捕获字节
    readonly progress?: ProcessProgressGroup
    readonly rootDir?: string
}

export type DevSupervisorOutcome =
    | { readonly kind: 'ended', readonly reason: 'user' | 'process' }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'failed', readonly exitCode: number, readonly message: string }

export class DevSupervisor {
    constructor(private readonly executor: Executor) { }

    async run(processes: readonly LongRunningProcessSpec[], options: DevSupervisorOptions = {}): Promise<DevSupervisorOutcome> {
        if (!processes.length) throw new Error("没有需要启动的开发进程")
        const controller = new AbortController()
        const children: { name: string, process: RunningProcess, progress?: ProcessProgress }[] = []
        type ChildExit = { name: string, result: ProcessResult, service: boolean, completedAt: number }
        const exits = new Map<string, ChildExit>()
        let firstCompleted: ChildExit | undefined
        let resolveExit!: (value: ChildExit) => void
        let rejectExit!: (error: unknown) => void
        const firstExit = new Promise<ChildExit>((resolve, reject) => {
            resolveExit = resolve
            rejectExit = reject
        })
        const abortSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
        const prematureExit = firstExit.then(({ name, result }) => {
            if (result.cancelled && abortSignal.aborted) throw abortSignal.reason
            throw new Error(`${name} 在准备就绪前退出（${result.exitCode}${result.signal ? `，信号 ${result.signal}` : ""}）`)
        })
        void prematureExit.catch(() => { })
        let primaryFailure: unknown
        let outcome: DevSupervisorOutcome | undefined
        let activeProcess: string | undefined
        let failedProcess: string | undefined
        let stopRequestedAt: number | undefined
        const cleanupFailures = new Map<string, unknown>()
        const stop = () => {
            stopRequestedAt ??= performance.now()
            controller.abort(new DOMException('用户请求正常结束', 'AbortError'))
        }
        try {
            const pending = [...processes]
            const ready = new Set<string>()
            if (new Set(processes.map(spec => spec.name)).size !== processes.length) throw new Error("开发进程名称重复")
            for (const spec of processes) for (const dependency of spec.dependsOn ?? []) if (!processes.some(candidate => candidate.name === dependency)) throw new Error(`开发进程 ${spec.name} 的依赖 ${dependency} 不存在`)
            while (pending.length) {
                abortSignal.throwIfAborted()
                const index = pending.findIndex(spec => (spec.dependsOn ?? []).every(name => ready.has(name)))
                if (index < 0) throw new Error("开发进程存在循环依赖")
                const spec = pending.splice(index, 1)[0]!
                activeProcess = spec.name
                if (spec.readyUrl && await Promise.race([this.responds(spec.readyUrl, abortSignal), prematureExit])) throw new Error(`开发地址已被占用：${spec.readyUrl}`)
                const progress: ProcessProgress | undefined = options.progress ? await options.progress.open({ id: spec.name, title: spec.title ?? spec.name, detail: spec.detail, rootDir: options.rootDir }) : undefined
                progress?.status("启动中", "info")
                const child = this.executor.start(progress ? progress.process({ ...spec, signal: abortSignal }) : { ...spec, signal: abortSignal })
                children.push({ name: spec.name, process: child, progress })
                void child.completion.then(async result => {
                    const exit = { name: spec.name, result, service: spec.exitPolicy === 'service', completedAt: performance.now() }
                    if (!result.cancelled) {
                        exits.set(spec.name, exit)
                        firstCompleted ??= exit
                        if (result.exitCode !== 0 || result.signal || result.timedOut || exit.service) failedProcess ??= spec.name
                    }
                    resolveExit(exit)
                }).catch(error => rejectExit(new Error(`开发进程 ${spec.name} 执行失败：${String(error)}`, { cause: error })))
                if (spec.readyUrl) await Promise.race([this.waitReady(spec, abortSignal, options.readinessTimeoutMs ?? devReadinessTimeoutMs), prematureExit])
                if (spec.waitReady) {
                    const timeout = AbortSignal.timeout(options.readinessTimeoutMs ?? devReadinessTimeoutMs)
                    await Promise.race([spec.waitReady(AbortSignal.any([abortSignal, timeout])).catch(error => {
                        if (timeout.aborted && !abortSignal.aborted) throw new Error(`${spec.name} 未在限定时间内确认窗口及首帧就绪`, { cause: error })
                        throw error
                    }), prematureExit])
                }
                if (firstCompleted) await prematureExit
                progress?.status(spec.readyUrl || spec.waitReady ? "就绪" : "运行中", "success")
                ready.add(spec.name)
            }
            abortSignal.throwIfAborted()
            options.stopSignal?.addEventListener('abort', stop, { once: true })
            if (options.stopSignal?.aborted) stop()
            options.onRunning?.()
            const exit = await firstExit
            const unexpected = firstCompleted ?? exit
            if (firstCompleted && (unexpected.result.exitCode !== 0 || unexpected.result.signal || unexpected.result.timedOut || unexpected.service)) outcome = { kind: 'failed', exitCode: unexpected.result.exitCode || 1, message: `${unexpected.name} 意外退出（退出码 ${unexpected.result.exitCode}）` }
            else if (options.signal?.aborted) outcome = { kind: 'cancelled' }
            else if (options.stopSignal?.aborted && firstCompleted?.service === false && firstCompleted.result.exitCode === 0 && stopRequestedAt !== undefined && firstCompleted.completedAt < stopRequestedAt) outcome = { kind: 'ended', reason: 'process' }
            else if (options.stopSignal?.aborted) outcome = { kind: 'ended', reason: 'user' }
            else outcome = { kind: 'ended', reason: 'process' }
        } catch (error) {
            if (options.signal?.aborted && (error === abortSignal.reason || isAbortError(error))) outcome = { kind: 'cancelled' }
            else {
                primaryFailure = error
                failedProcess ??= firstCompleted?.name ?? activeProcess
            }
        } finally {
            options.stopSignal?.removeEventListener('abort', stop)
            const failures: unknown[] = []
            try { options.onStopping?.() } catch (error) { failures.push(error) }
            controller.abort()
            const stopped = await Promise.allSettled(children.map(child => child.process.stop()))
            stopped.forEach((result, index) => {
                if (result.status !== 'rejected') return
                const error = new Error('开发进程清理失败：' + errorMessage(result.reason), { cause: result.reason })
                cleanupFailures.set(children[index]!.name, error)
                failures.push(error)
            })
            const original = primaryFailure ?? (outcome?.kind === 'failed' ? new Error(outcome.message) : undefined)
            const finishFor = (child: typeof children[number]): ProcessOutcome => {
                const exit = exits.get(child.name)
                if (cleanupFailures.has(child.name)) return { kind: 'failed', message: errorMessage(cleanupFailures.get(child.name)) }
                if (failedProcess === child.name) return { kind: 'failed', message: exit ? `${exit.name} 意外退出（退出码 ${exit.result.exitCode}）` : original instanceof Error ? original.message : errorMessage(original) }
                if (outcome?.kind === 'cancelled') return { kind: 'cancelled' }
                if (exit?.result.exitCode === 0) return { kind: 'exited', message: '已退出' }
                return { kind: 'stopped', reason: outcome?.kind === 'ended' && outcome.reason === 'user' ? 'user' : 'companion' }
            }
            const finished = await Promise.allSettled(children.map(child => child.progress?.finish(finishFor(child))))
            failures.push(...finished.flatMap(result => result.status === 'rejected' ? [new Error('开发进展清理失败：' + errorMessage(result.reason), { cause: result.reason })] : []))
            if (original !== undefined && failures.length) throw new AggregateError([original, ...failures], errorMessage(original) + '；' + failures.map(errorMessage).join('；'))
            if (failures.length === 1) throw failures[0]
            if (failures.length) throw new AggregateError(failures, failures.map(errorMessage).join('；'))
        }
        if (primaryFailure !== undefined) throw primaryFailure
        if (!outcome) throw new Error('开发监管未产生结束结果')
        return outcome
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
