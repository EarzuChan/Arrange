import { mkdir, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { z } from "zod"
import { operationPollMs, operationProtocolVersion } from "../../CliMetadata.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { KernelLock, type KernelHandle } from "./KernelLock.ts"
import { resourcesConflict, type Resource } from "./Resource.ts"

const resourceSchema = z.object({ kind: z.enum(["initialization", "configuration", "directory", "source", "endpoint"]), path: z.string(), mode: z.enum(["read", "write"]) })
const requestSchema = z.object({ id: z.string(), label: z.string(), resources: z.array(resourceSchema), granted: z.boolean(), order: z.number() })
const recordSchema = z.object({ schema: z.literal(operationProtocolVersion), worker: z.number(), client: z.number(), requests: z.array(requestSchema), processes: z.array(z.object({ id: z.string(), pid: z.number().optional(), launching: z.boolean() })) })
type Record = z.infer<typeof recordSchema>

// 每个工作进程持有一个内核生存锁；登记操作在短暂协调锁内完成，外部工具从不占协调锁
export class OperationRegistry {
    private readonly kernel = new KernelLock()
    private life: KernelHandle | undefined
    private record: Record
    private changes = Promise.resolve()

    constructor(private readonly directory: string, private readonly session: string, client: number) {
        this.record = { schema: operationProtocolVersion, worker: process.pid, client, requests: [], processes: [] }
    }

    private recordPath(session = this.session): string { return join(this.directory, `${session}.json`) }
    private lifePath(session = this.session): string { return join(this.directory, `${session}.kernel`) }

    async open(): Promise<void> {
        await mkdir(this.directory, { recursive: true })
        this.life = this.kernel.tryAcquire(this.lifePath())
        if (!this.life) throw new Error("资源会话身份重复")
        await this.change(async () => { })
    }

    private async change<T>(body: (records: readonly Record[]) => Promise<T>, signal?: AbortSignal, remove = false): Promise<T> {
        const next = this.changes.then(() => this.commitChange(body, signal, remove))
        this.changes = next.then(() => { }, () => { })
        return next
    }

    private async commitChange<T>(body: (records: readonly Record[]) => Promise<T>, signal?: AbortSignal, remove = false): Promise<T> {
        let gate: KernelHandle | undefined
        while (!(gate = this.kernel.tryAcquire(join(this.directory, "coordinator.kernel")))) await delay(operationPollMs, undefined, { signal })
        try {
            signal?.throwIfAborted()
            const records: Record[] = []
            for (const name of await readdir(this.directory)) {
                if (!name.endsWith(".json")) continue
                const session = name.slice(0, -5)
                if (session === this.session) continue
                const record = recordSchema.parse(JSON.parse(await readFile(this.recordPath(session), "utf8")))
                const dead = this.kernel.tryAcquire(this.lifePath(session))
                if (dead) {
                    try {
                        const uncertain = clientAlive(record.client) || record.processes.some(child => child.launching || child.pid !== undefined && processAlive(child.pid))
                        if (uncertain) {
                            // 不确定的遗留进程继续保护原资源，不能因为占用者死亡就接管
                            records.push(record)
                            continue
                        }
                        await rm(this.recordPath(session))
                    } finally { dead.close() }
                } else records.push(record)
            }
            const result = await body(records)
            if (remove) await rm(this.recordPath(), { force: true })
            else await writeAtomicText(this.recordPath(), `${JSON.stringify(this.record)}\n`)
            return result
        } finally { gate.close() }
    }

    async acquire(id: string, label: string, resources: readonly Resource[], observe: boolean, signal: AbortSignal, waiting: (message: string) => void): Promise<void> {
        let announced = ""
        try {
            while (true) {
                const granted = await this.change(async records => {
                    let request = this.record.requests.find(item => item.id === id)
                    if (!request) {
                        const order = Math.max(0, ...records.flatMap(record => record.requests.map(item => item.order)), ...this.record.requests.map(item => item.order)) + 1
                        request = { id, label, resources: [...resources], granted: false, order }
                        this.record.requests.push(request)
                    }
                    const candidates = [...records, this.record].flatMap(record => record.requests.map(other => ({ record, other })))
                    const blockers = candidates.filter(({ other }) => other.id !== id && (other.granted || other.order < request!.order) && other.resources.some(held => resources.some(resource => resourcesConflict(held, resource))))
                    if (!blockers.length) {
                        request.granted = true
                        return true
                    }
                    const first = blockers[0]!
                    const message = `等待 ${first.other.label}（CLI PID ${first.record.client}）释放资源：${first.other.resources.find(held => resources.some(resource => resourcesConflict(held, resource)))!.path}`
                    if (observe) throw new Error(`资源正在使用，无法稳定扫描；${message}`)
                    if (message !== announced) {
                        announced = message
                        waiting(message)
                    }
                    return false
                }, signal)
                if (granted) return
                await delay(operationPollMs, undefined, { signal })
            }
        } catch (error) {
            await this.release(id)
            throw error
        }
    }

    release(id: string): Promise<void> {
        return this.change(async () => { this.record.requests = this.record.requests.filter(item => item.id !== id) })
    }

    launching(id: string): Promise<void> {
        return this.change(async () => { this.record.processes.push({ id, launching: true }) })
    }

    started(id: string, pid: number | undefined): Promise<void> {
        return this.change(async () => {
            const child = this.record.processes.find(item => item.id === id)!
            child.pid = pid
            child.launching = false
        })
    }

    completed(id: string): Promise<void> {
        return this.change(async () => { this.record.processes = this.record.processes.filter(item => item.id !== id) })
    }

    async close(): Promise<void> {
        if (this.record.processes.length) throw new Error("受管工具尚未停止，不能释放操作会话")
        this.record.requests = []
        await this.change(async () => { }, undefined, true)
        this.life?.close()
        this.life = undefined
    }
}

function processAlive(pid: number): boolean {
    try {
        process.kill(process.platform === "win32" ? pid : -pid, 0)
        return true
    } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" }
}

function clientAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" }
}
