import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { UserDirectories } from "../user/UserDirectories.ts"
import type { StorageInventory, StorageItem } from "./StorageInventory.ts"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { DeleteTransaction } from "../transaction/DeleteTransaction.ts"
import { ReplacementTransaction } from "../transaction/ReplacementTransaction.ts"
import { readSourceRecord } from "../source/SourceCache.ts"
import type { GitSource } from "../source/GitSource.ts"
import type { TaskOutput } from "../operation/Work.ts"
import { cmakePreparationFileName } from "../../CliMetadata.ts"
import { assertOwnedPath } from "../transaction/TreeState.ts"
import { storagePathIdentity, directoryNames } from "./StoragePaths.ts"

export class StorageMaintenance {
    constructor(private readonly user: UserDirectories, private readonly inventory: StorageInventory, private readonly git: GitSource, private readonly signal: AbortSignal, private readonly projects?: ProjectRegistry) { }

    async clean(selected: readonly StorageItem[]): Promise<void> {
        const current = await this.inventory.inspect()
        const pending = await new TransactionStore(this.user.root, this.user.transactions).list()
        if (pending.length) throw new Error("用户级存在未完成事务，请先运行 arrange storage recover")
        const entries: { root: string, path: string }[] = []
        for (const selectedItem of selected) {
            const item = current.find(item => item.id === selectedItem.id)
            if (!item?.cleanup.allowed || item.path !== selectedItem.path) throw new Error(`清理计划已变化：${selectedItem.id}`)
            entries.push(item)
            if (item.kind === "deps-src") for (const name of await directoryNames(join(this.user.dependencySources, "requests"))) if (/^[a-f0-9]{64}\.json$/.test(name)) {
                const path = join(this.user.dependencySources, "requests", name)
                const record = await readSourceRecord(path)
                if (record.key === item.id.slice("deps-src:".length)) entries.push({ root: this.user.dependencySources, path })
            }
        }
        if (!entries.length) return
        const transaction = new DeleteTransaction(new TransactionStore(this.user.root, this.user.transactions), this.signal)
        await transaction.apply(await transaction.prepare(entries))
        if (this.projects) {
            const remaining = await this.inventory.inspect()
            for (const registration of await this.projects.list()) if (registration.record) {
                const availability = await this.projects.availability(registration.record.root, registration.record.kind === "verification")
                if (availability !== "missing" && availability !== "replaced") continue
                if (!remaining.some(item => item.kind === "build" && item.owner && storagePathIdentity(item.owner) === storagePathIdentity(registration.record!.root) && item.facts.some(fact => fact.label === "ownership" && fact.check.state === "ready"))) await this.projects.remove(registration.path)
            }
        }
    }

    async repair(key: string, task: TaskOutput): Promise<void> {
        if (!/^[a-f0-9]{16}$/.test(key)) throw new Error("依赖源码条目 ID 必须为 16 位十六进制")
        const path = join(this.user.dependencySources, "entries", key)
        if ((await new TransactionStore(this.user.root, this.user.transactions).list()).length) throw new Error("用户级存在未完成事务，请先运行 arrange storage recover")
        const record = await readSourceRecord(join(path, "complete.json"))
        if (record.key !== key) throw new Error("依赖源码条目与发布记录身份不符")
        const items = await this.inventory.inspect()
        const item = items.find(item => item.id === `deps-src:${key}`)
        if (!item || item.references.complete !== true || !item.repairable) throw new Error("无法确认全部构建引用，拒绝修复")
        const temporary = join(this.user.dependencySources, "tmp", `repair-${randomUUID()}`)
        await this.user.ensure(temporary)
        const transaction = new ReplacementTransaction(new TransactionStore(this.user.root, this.user.transactions), this.signal)
        const cleanup = [{ root: this.user.dependencySources, path: temporary }]
        const operation = await transaction.begin(cleanup)
        const staged = join(temporary, "entry")
        await mkdir(join(staged, "source"), { recursive: true })
        try {
            await this.git.checkout({ ...record.source, ref: record.commit, commit: record.commit }, join(staged, "source"), task, this.signal)
            await this.git.verify(join(staged, "source"), this.signal)
            await writeFile(join(staged, "complete.json"), `${JSON.stringify(record, null, 4)}\n`)
            for (const build of item.references.paths) {
                await assertOwnedPath(build, join(build, cmakePreparationFileName))
                await rm(join(build, cmakePreparationFileName), { force: true })
            }
            await transaction.prepare([{ root: this.user.dependencySources, destination: path, staged, backup: join(temporary, "backup") }], cleanup, operation)
            await transaction.apply(operation)
        } catch (error) {
            operation.status = "failed"
            operation.error = String(error)
            await new TransactionStore(this.user.root, this.user.transactions).save(operation)
            throw error
        }
    }
}
