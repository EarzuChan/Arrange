import { basename, dirname, join, resolve } from "node:path"
import type { UserDirectories } from "../user/UserDirectories.ts"
import type { ProjectRegistration } from "../user/ProjectRegistry.ts"
import type { CmakeService } from "../cmake/CmakeService.ts"
import { buildOwnerFileName, sourceReferencesFileName, sourceReferencesSchema, nativeVerificationFileName, nativeVerificationSchema } from "../CliMetadata.ts"
import { buildReferencesSchema } from "../source/BuildReferences.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { readCurrentRecord, inspectionFailure, InspectionError, type InspectionFact } from "../util/RecordInspection.ts"
import { containsPath } from "../transaction/TreeState.ts"
import { directoryNames, storageId, storageUsage, buildPathKey, assertDirectory, storagePathIdentity } from "./StoragePaths.ts"
import type { StorageItem } from "./StorageFacts.ts"
import type { ProjectInspection } from "./ProjectInspection.ts"
import { buildOwnerRecordSchema } from "../cmake/BuildOwnerRecord.ts"
import { nativeVerificationRecordSchema } from "../cmake/NativeVerificationRecord.ts"

export interface BuildReference { readonly directory: string, readonly build: string }

export class BuildInventory {
    constructor(private readonly user: UserDirectories, private readonly projects: ProjectInspection, private readonly cmake: Pick<CmakeService, "inspect" | "buildDirectory">, private readonly signal: AbortSignal) { }

    async inspect(registrations: readonly { path: string, record?: ProjectRegistration, issue?: InspectionFact }[]) {
        const items: StorageItem[] = []
        const references: BuildReference[] = []
        const blockers: InspectionFact[] = []
        const seen = new Set<string>()
        const inspect = async (path: string, root: string, registration?: ProjectRegistration): Promise<void> => {
            if (seen.has(storagePathIdentity(path))) return
            seen.add(storagePathIdentity(path))
            const blockStart = blockers.length
            this.signal.throwIfAborted()
            const facts: StorageItem["facts"][number][] = []
            let owner: string | undefined
            let owned = false
            let present = false
            let project: InspectionFact | undefined
            let configurations: string[] = []
            let blocked = false
            try {
                await assertPlainDirectoryPath(root, path)
                await assertDirectory(path)
                present = true
                const recordPath = join(path, registration ? nativeVerificationFileName : buildOwnerFileName)
                if (registration) {
                    const record = await readCurrentRecord(recordPath, nativeVerificationRecordSchema, { field: "version", supported: nativeVerificationSchema })
                    if (!containsPath(registration.root, record.source)) throw new InspectionError({ state: "damaged", path: recordPath, reason: "验收构建记录的源码不属于登记根" })
                    owner = registration.root
                    configurations = [path]
                    facts.push({ label: "preparation", check: { state: record.complete ? "ready" : "incomplete", path, reason: record.complete ? "验收构建准备已完成" : "验收构建准备未完成" } })
                } else {
                    const record = await readCurrentRecord(recordPath, buildOwnerRecordSchema)
                    if (buildPathKey(record.rootDir) !== basename(path)) throw new InspectionError({ state: "damaged", path: recordPath, reason: "owner 工程路径与构建目录身份不匹配" })
                    owner = record.rootDir
                    configurations = (await directoryNames(path)).filter(name => /^(?:mac-)?[ax][dr]$/.test(name)).map(name => join(path, name))
                }
                owned = true
                facts.push({ label: "ownership", check: { state: "ready", path: recordPath, reason: `归属已确认：${owner}` } })
                project = (await this.projects.inspect(owner, !!registration)).check
                facts.push({ label: "project", check: project })
                if (project.state === "unavailable") {
                    blockers.push(project)
                    blocked = true
                }
            } catch (error) {
                const check = inspectionFailure(error, present ? join(path, registration ? nativeVerificationFileName : buildOwnerFileName) : path)
                facts.push({ label: present ? "ownership" : "content", check })
                if (check.state !== "missing" || present) {
                    blockers.push(check)
                    blocked = true
                }
            }
            const ownReferences: string[] = []
            for (const configuration of configurations) {
                const refsPath = join(configuration, sourceReferencesFileName)
                try {
                    await assertPlainDirectoryPath(root, configuration)
                    await assertDirectory(configuration)
                    const refs = await readCurrentRecord(refsPath, buildReferencesSchema, { field: "schema", supported: sourceReferencesSchema })
                    for (const directory of refs.directories) references.push({ directory: resolve(directory), build: configuration })
                    ownReferences.push(...refs.directories)
                } catch (error) {
                    const check = inspectionFailure(error, refsPath)
                    blockers.push(check)
                    blocked = true
                }
                if (!registration && owner) {
                    const probe = await this.projects.inspect(owner)
                    const flavor = basename(configuration).endsWith("d") ? "debug" : "release"
                    let check: InspectionFact = { state: "unknown", path: configuration, reason: "所属工程配置不可用，无法验证准备状态" }
                    if (probe.state) {
                        try {
                            if (storagePathIdentity(this.cmake.buildDirectory(probe.state, flavor)) !== storagePathIdentity(configuration)) check = { state: "stale", path: configuration, reason: "构建配置与当前平台、架构或构建根选择不匹配" }
                            else {
                                const result = await this.cmake.inspect(probe.state, flavor)
                                check = result.issue ?? { state: result.ready ? "ready" : "stale", path: configuration, reason: result.ready ? "当前工程配置与准备模型匹配" : result.reason ?? "尚未准备" }
                            }
                        } catch (error) {
                            this.signal.throwIfAborted()
                            check = inspectionFailure(error, configuration)
                        }
                    }
                    facts.push({ label: "preparation", check })
                }
            }
            if (owned && present && !configurations.length) facts.push({ label: "preparation", check: { state: "missing", path, reason: "没有已配置的构建树" } })
            const orphan = owned && present && (project?.state === "missing" || project?.state === "replaced")
            items.push({ id: storageId("build", path), kind: "build", path, root, owner, ...await storageUsage(path, this.signal), facts, references: { complete: !blocked, paths: [...new Set(ownReferences)], blockers: blockers.slice(blockStart) }, cleanup: { allowed: orphan, reason: orphan ? "归属明确，所属工程已丢失或身份失效，可清理孤儿构建" : !present ? "目录已丢失，无实体内容可清理" : !owned ? "归属未确认，不能授权删除" : project?.state === "unavailable" ? "所属工程无法访问，不能认定为孤儿构建" : "所属工程仍存在，使用工程 clean 清理生成结果" } })
        }
        const roots = new Set([this.user.builds])
        for (const entry of registrations) if (entry.record) {
            entry.record.buildRoots.forEach(root => roots.add(root))
            for (const path of entry.record.buildTrees) await inspect(path, dirname(path), entry.record)
        }
        for (const root of roots) {
            try {
                await assertPlainDirectoryPath(root, root)
                for (const name of await directoryNames(root)) await inspect(join(root, name), root)
            } catch (error) {
                const check = inspectionFailure(error, root)
                if (check.state === "missing") continue
                blockers.push(check)
                items.push({ id: storageId("build", root), kind: "build", path: root, root, bytes: 0, sizeComplete: false, facts: [{ label: "content", check }], references: { complete: false, paths: [], blockers: [check] }, cleanup: { allowed: false, reason: "构建根无法检查，不能授权删除" } })
            }
        }
        // 登记只提供发现线索，丢失条目仍需出现在库存中
        for (const entry of registrations) if (entry.record && entry.record.kind === "project") for (const root of entry.record.buildRoots) await inspect(join(root, buildPathKey(entry.record.root)), root)
        return { items, references, blockers }
    }
}
