import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { rename, rm } from "node:fs/promises"
import { z } from "zod"
import { TransactionStore, type TransactionRecord } from "./TransactionStore.ts"
import { assertOwnedPath, treeIdentity } from "./TreeState.ts"

const payloadSchema = z.object({ entries: z.array(z.object({ root: z.string(), path: z.string(), quarantine: z.string(), identity: z.string(), state: z.enum(["pending", "moved", "deleting", "deleted"]) })) })

export class DeleteTransaction {
    constructor(private readonly store: TransactionStore, private readonly signal?: AbortSignal) { }

    async conflicts(record: TransactionRecord): Promise<readonly string[]> {
        const conflicts: string[] = []
        for (const entry of payloadSchema.parse(record.payload).entries) {
            if (entry.state === "deleted" || entry.state === "deleting") continue
            const [current, quarantined] = await Promise.all([entry.path, entry.quarantine].map(treeIdentity))
            if (entry.state === "pending" ? !((current === entry.identity && quarantined === null) || (current === null && quarantined === entry.identity)) : quarantined !== entry.identity) conflicts.push(`清理内容已变化：${entry.path}`)
        }
        return conflicts
    }

    async prepare(entries: readonly { root: string, path: string }[]): Promise<TransactionRecord> {
        const recorded: z.infer<typeof payloadSchema>["entries"] = []
        for (const entry of entries) {
            await assertOwnedPath(entry.root, entry.path)
            const identity = await treeIdentity(entry.path)
            if (identity !== null) recorded.push({ ...entry, quarantine: join(dirname(entry.path), `.arrange-delete-${randomUUID()}`), identity, state: "pending" })
        }
        return this.store.create("delete", { entries: recorded })
    }

    async apply(record: TransactionRecord): Promise<void> {
        const payload = payloadSchema.parse(record.payload)
        record.payload = payload
        record.status = "running"
        await this.store.save(record)
        try {
            for (const entry of payload.entries) {
                this.signal?.throwIfAborted()
                await assertOwnedPath(entry.root, entry.path)
                await assertOwnedPath(entry.root, entry.quarantine)
                if (entry.state === "deleted") continue
                if (entry.state === "pending") {
                    const current = await treeIdentity(entry.path)
                    const quarantined = await treeIdentity(entry.quarantine)
                    if (current === entry.identity && quarantined === null) await rename(entry.path, entry.quarantine)
                    else if (!(current === null && quarantined === entry.identity)) throw new Error(`清理计划已变化：${entry.path}`)
                    entry.state = "moved"
                    await this.store.save(record)
                }
                if (entry.state === "moved" && await treeIdentity(entry.quarantine) !== entry.identity) throw new Error(`隔离内容已变化：${entry.quarantine}`)
                entry.state = "deleting"
                await this.store.save(record)
                await rm(entry.quarantine, { recursive: true, force: true })
                entry.state = "deleted"
                await this.store.save(record)
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
        return payloadSchema.parse(record.payload).entries.flatMap(entry => [entry.path, entry.quarantine].map(path => ({ root: entry.root, path })))
    }
}
