import { basename, join } from "node:path"
import type { UserDirectories } from "../user/UserDirectories.ts"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"
import type { GitSource } from "../source/GitSource.ts"
import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import type { CmakeService } from "../cmake/CmakeService.ts"
import { BuildInventory } from "./BuildInventory.ts"
import { DependencyInventory } from "./DependencyInventory.ts"
import { ProjectInspection } from "./ProjectInspection.ts"
import { emptyReferences, type StorageItem } from "./StorageFacts.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { inspectionFailure, type InspectionFact } from "../util/RecordInspection.ts"
export type { StorageItem } from "./StorageFacts.ts"

export class StorageInventory {
    constructor(private readonly user: UserDirectories, private readonly projects: ProjectRegistry, private readonly git: Pick<GitSource, "verify">, private readonly signal: AbortSignal, private readonly store: ProjectStateStore, private readonly cmake: Pick<CmakeService, "inspect" | "buildDirectory">) { }

    async inspect(): Promise<readonly StorageItem[]> {
        this.signal.throwIfAborted()
        let registrations: Awaited<ReturnType<ProjectRegistry["list"]>>
        try { registrations = await this.projects.list() } catch (error) { registrations = [{ path: this.user.projects, issue: inspectionFailure(error, this.user.projects) }] }
        const projectProbe = new ProjectInspection(this.projects, this.store)
        const items: StorageItem[] = []
        for (const entry of registrations) {
            const facts: StorageItem["facts"][number][] = [{ label: "record", check: entry.issue ?? { state: "ready", path: entry.path, reason: "当前格式工程登记有效" } }]
            if (entry.record) facts.push({ label: "project", check: (await projectProbe.inspect(entry.record.root, entry.record.kind === "verification")).check })
            items.push({ id: `project:${basename(entry.path, ".json")}`, kind: "project", path: entry.record?.root ?? entry.path, root: this.user.projects, owner: entry.path, bytes: 0, sizeComplete: true, facts, references: emptyReferences, cleanup: { allowed: false, reason: "工程登记随已确认的孤儿构建清理收尾；异常登记需人工检查" } })
        }
        const builds = await new BuildInventory(this.user, projectProbe, this.cmake, this.signal).inspect(registrations)
        items.push(...builds.items)
        const blockers = [...registrations.flatMap(entry => entry.issue ? [entry.issue] : []), ...builds.blockers]
        for (const item of items.filter(item => item.kind === "project")) for (const fact of item.facts) if (fact.label === "project" && fact.check.state === "unavailable") blockers.push(fact.check)
        items.push(...await new DependencyInventory(this.user, this.git, this.signal).inspect(builds.references, blockers))
        const pending = await new TransactionStore(this.user.root, this.user.transactions).list()
        if (!pending.length) return items
        const transactions: InspectionFact[] = pending.map(entry => ({ state: entry.error ? "damaged" : "incomplete", path: join(this.user.transactions, `${entry.id}.json`), reason: entry.error ?? `用户事务 ${entry.id} 未收尾，请运行 arrange storage recover` }))
        return items.map(item => ({ ...item, facts: [...item.facts, ...transactions.map(check => ({ label: "transaction" as const, check }))], cleanup: { allowed: false, reason: "用户级事务尚未收尾，请先运行 arrange storage recover" }, repairable: false }))
    }
}
