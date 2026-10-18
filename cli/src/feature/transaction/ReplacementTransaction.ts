import { rename, rm } from "node:fs/promises"
import { z } from "zod"
import { TransactionStore, type TransactionRecord } from "./TransactionStore.ts"
import { assertOwnedPath, treeIdentity } from "./TreeState.ts"

const stepSchema = z.object({ root: z.string(), destination: z.string(), staged: z.string(), backup: z.string(), original: z.string().nullable(), expected: z.string(), state: z.enum(["pending", "backed-up", "published"]) })
const payloadSchema = z.object({ phase: z.enum(["staging", "ready"]), steps: z.array(stepSchema), cleanup: z.array(z.object({ root: z.string(), path: z.string() })) })
export type ReplacementStep = z.infer<typeof stepSchema>

// 每次移动前先保存意图；崩溃后的事实由内容身份判断，不能只相信进度标记
export class ReplacementTransaction {
    constructor(private readonly store: TransactionStore, private readonly signal?: AbortSignal, private readonly move: (source: string, destination: string) => Promise<void> = rename) { }

    begin(cleanup: readonly { root: string, path: string }[]): Promise<TransactionRecord> { return this.store.create("replace", { phase: "staging", steps: [], cleanup }) }

    async inspect(record: TransactionRecord): Promise<{ conflicts: readonly string[], continue: boolean, rollback: boolean }> {
        const payload = payloadSchema.parse(record.payload)
        const conflicts: string[] = []
        let canContinue = payload.phase === "ready"
        let canRollback = true
        for (const step of payload.steps) {
            const [destination, staged, backup] = await Promise.all([step.destination, step.staged, step.backup].map(treeIdentity))
            if (backup !== null && backup !== step.original) conflicts.push(`备份已修改：${step.backup}`)
            if (destination !== null && destination !== step.original && destination !== step.expected) conflicts.push(`目标已修改：${step.destination}`)
            if (staged !== null && staged !== step.expected) conflicts.push(`暂存已修改：${step.staged}`)
            if (!(destination === step.expected && staged === null) && staged !== step.expected) canContinue = false
            if (!(destination === step.original && backup === null) && step.original !== null && backup !== step.original) canRollback = false
        }
        return { conflicts, continue: canContinue && !conflicts.length, rollback: canRollback && !conflicts.length }
    }

    async prepare(steps: readonly { root: string, destination: string, staged: string, backup: string }[], cleanup: readonly { root: string, path: string }[] = [], record?: TransactionRecord): Promise<TransactionRecord> {
        const recorded: ReplacementStep[] = []
        for (const step of steps) {
            for (const path of [step.destination, step.staged, step.backup]) await assertOwnedPath(step.root, path)
            if (await treeIdentity(step.backup) !== null) throw new Error("备份目标已存在")
            const expected = await treeIdentity(step.staged)
            if (!expected) throw new Error("暂存内容不存在")
            recorded.push({ ...step, original: await treeIdentity(step.destination), expected, state: "pending" })
        }
        if (!record) return this.store.create("replace", { phase: "ready", steps: recorded, cleanup })
        record.payload = { phase: "ready", steps: recorded, cleanup }
        await this.store.save(record)
        return record
    }

    async apply(record: TransactionRecord, rollback = false): Promise<void> {
        const payload = payloadSchema.parse(record.payload)
        if (!rollback && payload.phase !== "ready") throw new Error("暂存未完成，只能回退清除暂存内容")
        record.payload = payload
        record.status = "running"
        await this.store.save(record)
        try {
            for (const step of rollback ? [...payload.steps].reverse() : payload.steps) {
                this.signal?.throwIfAborted()
                for (const path of [step.destination, step.staged, step.backup]) await assertOwnedPath(step.root, path)
                const destination = await treeIdentity(step.destination)
                const staged = await treeIdentity(step.staged)
                const backup = await treeIdentity(step.backup)
                if (backup !== null && backup !== step.original) throw new Error(`备份冲突：${step.backup}`)
                if (rollback) {
                    if (destination === step.original && backup === null) continue
                    if (destination !== null && destination !== step.expected) throw new Error(`目标被修改：${step.destination}`)
                    if (destination !== null) await rm(step.destination, { recursive: true })
                    if (step.original !== null) {
                        if (backup !== step.original) throw new Error(`缺少原始备份：${step.backup}`)
                        await this.move(step.backup, step.destination)
                    }
                    step.state = "pending"
                } else {
                    if (destination === step.expected && staged === null) {
                        step.state = "published"
                        continue
                    }
                    if (staged !== step.expected || (destination !== null && destination !== step.original)) throw new Error(`暂存或目标冲突：${step.destination}`)
                    if (destination !== null) {
                        if (backup !== null) throw new Error("目标与备份同时存在，无法自动判断")
                        await this.store.save(record)
                        await this.move(step.destination, step.backup)
                        step.state = "backed-up"
                        await this.store.save(record)
                    } else if (step.original !== null && backup === null) throw new Error(`原始内容丢失：${step.destination}`)
                    await this.move(step.staged, step.destination)
                    step.state = "published"
                }
                await this.store.save(record)
            }
            for (const entry of payload.cleanup) {
                await assertOwnedPath(entry.root, entry.path)
                await rm(entry.path, { recursive: true, force: true })
            }
            // 默认备份位于 cleanup 内；独立调用仍需清除已经确认的备份和暂存
            for (const step of payload.steps) {
                for (const path of [step.backup, step.staged]) {
                    const identity = await treeIdentity(path)
                    if (identity !== null) {
                        if (identity !== (path === step.backup ? step.original : step.expected)) throw new Error(`收尾内容冲突：${path}`)
                        await rm(path, { recursive: true })
                    }
                }
            }
            await this.store.finish(record)
        } catch (error) {
            record.status = "failed"
            record.error = String(error)
            await this.store.save(record)
            throw error
        }
    }

    paths(record: TransactionRecord): readonly { root: string, path: string }[] {
        const payload = payloadSchema.parse(record.payload)
        return [...payload.steps.flatMap(step => [step.destination, step.staged, step.backup].map(path => ({ root: step.root, path }))), ...payload.cleanup]
    }
}
