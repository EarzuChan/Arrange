import { dirname, isAbsolute, resolve } from "node:path"
import type { Operations } from "../operation/Operations.ts"
import { canonicalResource, type Resource } from "../operation/Resource.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { DeleteTransaction } from "./DeleteTransaction.ts"
import { InitializationRecovery } from "./InitializationRecovery.ts"
import { ReplacementTransaction } from "./ReplacementTransaction.ts"
import { TransactionStore, type TransactionRecord } from "./TransactionStore.ts"
import { WriteRecovery } from "./WriteRecovery.ts"
import { containsPath } from "./TreeState.ts"

export class RecoveryService {
    constructor(readonly store: TransactionStore, private readonly operations: Operations, private readonly signal: AbortSignal, private readonly lifetime: Resource, private readonly allowedRoots: readonly string[] = [store.root]) { }

    async inspect(id?: string) {
        return id ? [{ id, record: await this.store.read(id), error: undefined }] : this.store.list()
    }

    async plan(id: string) {
        const record = await this.store.read(id)
        const paths = this.paths(record)
        await this.validate(paths)
        if (record.kind === "replace") return { record, paths, ...await new ReplacementTransaction(this.store).inspect(record) }
        const conflicts = record.kind === "write" ? await new WriteRecovery(this.store, this.signal).conflicts(record) : record.kind === "initialize" ? await new InitializationRecovery(this.store, this.signal).conflicts(record) : await new DeleteTransaction(this.store).conflicts(record)
        return { record, paths, conflicts, continue: !conflicts.length, rollback: record.kind !== "delete" && !conflicts.length }
    }

    async apply(id: string, rollback: boolean): Promise<void> {
        const before = await this.store.read(id)
        const paths = this.paths(before)
        const resources: Resource[] = [this.lifetime, { kind: "initialization", path: this.store.root, mode: "write" }, ...paths.map(entry => ({ kind: "directory" as const, path: entry.path, mode: "write" as const }))]
        await this.operations.run(resources, "恢复事务", async () => {
            const record = await this.store.read(id)
            if (JSON.stringify(before) !== JSON.stringify(record)) throw new Error("事务在确认后发生变化，请重新查看")
            await this.validate(paths)
            const plan = await this.plan(id)
            if (rollback ? !plan.rollback : !plan.continue) throw new Error(`恢复冲突，当前事务不能${rollback ? "回退" : "继续"}：${plan.conflicts.join("；") || "缺少所需内容"}`)
            if (record.kind === "delete") {
                if (rollback) throw new Error("清理事务只支持继续，已删除内容不可回退")
                await new DeleteTransaction(this.store, this.signal).apply(record)
            } else if (record.kind === "replace") await new ReplacementTransaction(this.store, this.signal).apply(record, rollback)
            else if (record.kind === "initialize") await new InitializationRecovery(this.store, this.signal).apply(record, rollback)
            else await new WriteRecovery(this.store, this.signal).apply(record, rollback)
        })
    }

    private async validate(paths: readonly { root: string, path: string }[]): Promise<void> {
        const roots = await Promise.all(this.allowedRoots.map(path => canonicalResource({ kind: "directory", path, mode: "read" })))
        for (const entry of paths) {
            if (!isAbsolute(entry.root) || !isAbsolute(entry.path)) throw new Error("事务路径必须为绝对路径")
            const canonical = await canonicalResource({ kind: "directory", path: entry.path, mode: "read" })
            const trusted = roots.find(root => root.path !== canonical.path && containsPath(root.path, canonical.path))
            if (!trusted) throw new Error(`恢复路径不在已确认归属内：${entry.path}`)
            await assertPlainDirectoryPath(entry.root, dirname(entry.path))
        }
    }

    private paths(record: TransactionRecord): readonly { root: string, path: string }[] {
        if (record.kind === "delete") return new DeleteTransaction(this.store).paths(record)
        if (record.kind === "replace") return new ReplacementTransaction(this.store).paths(record)
        const paths = record.kind === "initialize" ? new InitializationRecovery(this.store, this.signal).paths(record) : new WriteRecovery(this.store, this.signal).paths(record)
        return paths.map(path => ({ root: record.root, path }))
    }
}
