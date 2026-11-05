import { Executor } from "../platform/Executor.ts"
import { ManagedProcesses } from "./ManagedProcesses.ts"
import type { WorkerRequest, WorkerResponse } from "./Protocol.ts"
import { OperationRegistry } from "./Registry.ts"
import { ownWindowsJob } from "./WindowsJob.ts"

const [directory, session, client] = process.argv.slice(2) as [string, string, string]
const registry = new OperationRegistry(directory, session, Number(client))
const executor = new Executor()
const pending = new Map<string, AbortController>()
const active = new Set<Promise<void>>()
// 终端 Ctrl+C 由客户端经 IPC 取消任务；工作进程必须活到清理完成，不能随控制台广播提前退出
process.on("SIGINT", () => { })
let closing = false
const job = ownWindowsJob()
const send = (response: WorkerResponse): void => { if (process.connected) process.send!(response, () => { }) }
let mutations = Promise.resolve()
const mutate = <T>(body: () => Promise<T>): Promise<T> => {
    const next = mutations.then(body)
    mutations = next.then(() => { }, () => { })
    return next
}

const processes = new ManagedProcesses(id => mutate(() => registry.completed(id)))

async function close(): Promise<void> {
    if (closing) return
    closing = true
    for (const controller of pending.values()) controller.abort()
    if (!await processes.stopAll()) throw new Error("受管工具清理失败，保留资源占用")
    await Promise.allSettled([...active])
    await mutations
    await registry.close()
    job?.release()
}

async function handle(message: WorkerRequest): Promise<void> {
    try {
        if (message.kind === "close") {
            await close()
            send({ kind: "ok", id: message.id })
            process.disconnect()
            return
        }
        if (closing) throw new Error("资源工作进程正在结束")
        if (message.kind === "acquire") {
            const controller = new AbortController()
            pending.set(message.id, controller)
            try { await registry.acquire(message.id, message.label, message.resources, message.observe, controller.signal, text => send({ kind: "waiting", id: message.id, message: text })) } finally { pending.delete(message.id) }
            send({ kind: "ok", id: message.id })
        } else if (message.kind === "release") {
            if (!await processes.retry()) throw new Error("工具尚未确认停止，保留资源占用")
            await registry.release(message.id)
            send({ kind: "ok", id: message.id })
        } else if (message.kind === "cancel") pending.get(message.id)?.abort()
        else if (message.kind === "start") {
            const controller = new AbortController()
            pending.set(message.id, controller)
            await mutate(() => registry.launching(message.id))
            if (closing) {
                await mutate(() => registry.completed(message.id))
                throw new DOMException("操作已取消", "AbortError")
            }
            const child = executor.start({ ...message.process, signal: controller.signal, onOutput: (bytes, channel) => send({ kind: "output", id: message.id, bytes: bytes.toString("base64"), channel }) })
            void child.completion.catch(() => { })
            processes.add(message.id, child)
            await mutate(() => registry.started(message.id, child.pid))
            try {
                const result = await child.completion
                // 主进程结束不代表后代已结束；确认前不撤销登记，任务本身的结果不因清理未确认而改变
                const cleanup = await processes.confirm(message.id)
                send({ kind: "result", id: message.id, result: { ...result, cleanup } })
            } catch (error) {
                if (child.pid === undefined) await processes.discard(message.id)
                else processes.markUnconfirmed(message.id)
                throw error
            } finally { pending.delete(message.id) }
        }
    } catch (error) {
        send({ kind: "error", id: message.id, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) })
    }
}

await registry.open()
process.on("message", message => {
    const request = message as WorkerRequest
    const task = handle(request)
    if (request.kind !== "close") {
        active.add(task)
        void task.finally(() => active.delete(task))
    }
})
process.on("disconnect", () => { void close().then(() => process.exit(0), () => process.exit(1)) })
send({ kind: "ready" })
