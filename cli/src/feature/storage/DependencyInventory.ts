import { lstat, readFile } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import type { UserDirectories } from "../user/UserDirectories.ts"
import type { GitSource } from "../source/GitSource.ts"
import { readSourceRecord } from "../source/SourceCache.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { inspectionFailure, InspectionError, type InspectionFact } from "../../util/RecordInspection.ts"
import { containsPath } from "../transaction/TreeState.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { directoryNames, storageUsage, assertDirectory } from "./StoragePaths.ts"
import { emptyReferences, type StorageItem } from "./StorageFacts.ts"
import type { BuildReference } from "./BuildInventory.ts"

export class DependencyInventory {
    constructor(private readonly user: UserDirectories, private readonly git: Pick<GitSource, "verify">, private readonly signal: AbortSignal) { }

    async inspect(referenced: readonly BuildReference[], buildBlockers: readonly InspectionFact[]): Promise<readonly StorageItem[]> {
        const items: StorageItem[] = []
        const blockers = [...buildBlockers]
        const entries = join(this.user.dependencySources, "entries")
        const keys = new Set<string>()
        try {
            for (const directory of [this.user.dependencySources, entries, join(this.user.dependencySources, "requests"), join(this.user.dependencySources, "tmp")]) await assertPlainDirectoryPath(this.user.root, directory)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
            const check = inspectionFailure(error, this.user.dependencySources)
            return [{ id: "deps-src:root", kind: "deps-src", path: this.user.dependencySources, root: this.user.root, bytes: 0, sizeComplete: false, facts: [{ label: "content", check }], references: { complete: false, paths: [], blockers: [check] }, cleanup: { allowed: false, reason: "依赖源码根无法检查，不能授权删除" } }]
        }
        for (const name of await directoryNames(entries)) keys.add(name)
        for (const reference of referenced) if (containsPath(entries, reference.directory)) keys.add(relative(entries, reference.directory).split(/[\\/]/)[0])
        const requests = join(this.user.dependencySources, "requests")
        for (const name of await directoryNames(requests)) {
            const path = join(requests, name)
            try {
                if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new InspectionError({ state: "unknown", path, reason: "无法识别的依赖源码索引文件" })
                const record = await readSourceRecord(path)
                if (record.identity !== basename(path, ".json")) throw new InspectionError({ state: "damaged", path, reason: "请求身份与索引文件名不匹配" })
                keys.add(record.key)
            } catch (error) {
                const check = inspectionFailure(error, path)
                blockers.push(check)
                items.push({ id: `deps-src-index:${basename(path, ".json")}`, kind: "deps-src", path, root: requests, ...await storageUsage(path, this.signal), facts: [{ label: "index", check }], references: emptyReferences, cleanup: { allowed: false, reason: "索引身份未确认，需人工检查" } })
            }
        }
        for (const key of keys) {
            this.signal.throwIfAborted()
            const path = join(entries, key)
            const recordPath = join(path, "complete.json")
            const facts: StorageItem["facts"][number][] = []
            let recordValid = false
            let contentValid = false
            let repairable = false
            try {
                if (!/^[a-f0-9]{16}$/.test(key)) throw new InspectionError({ state: "unknown", path, reason: "无法识别的依赖源码条目目录" })
                await assertPlainDirectoryPath(this.user.root, path)
                await assertDirectory(path)
                const record = await readSourceRecord(recordPath)
                if (record.key !== key) throw new InspectionError({ state: "damaged", path: recordPath, reason: "发布记录身份与条目目录不匹配" })
                recordValid = true
                facts.push({ label: "record", check: { state: "ready", path: recordPath, reason: `当前格式发布记录有效，commit ${record.commit}` } })
                const source = join(path, "source")
                try {
                    await assertPlainDirectoryPath(this.user.root, join(source, ".git"))
                    await assertDirectory(source)
                    const head = (await readFile(join(source, ".git", "HEAD"), "utf8")).trim()
                    if (head !== record.commit) throw new InspectionError({ state: "damaged", path: join(source, ".git", "HEAD"), reason: "HEAD 与发布记录的确切 commit 不符" })
                    const cmake = await lstat(join(source, "CMakeLists.txt"))
                    if (!cmake.isFile() || cmake.isSymbolicLink()) throw new InspectionError({ state: "damaged", path: source, reason: "依赖源码入口不是普通文件" })
                    await this.git.verify(source, this.signal)
                    contentValid = true
                    facts.push({ label: "content", check: { state: "ready", path: source, reason: "源码入口、detached HEAD 与受跟踪文件验证通过" } })
                } catch (error) {
                    this.signal.throwIfAborted()
                    const check = inspectionFailure(error, source)
                    repairable = check.state === "missing" || check.state === "damaged"
                    facts.push({ label: "content", check })
                }
            } catch (error) {
                const check = inspectionFailure(error, recordPath)
                facts.push({ label: "record", check })
            }
            const references = [...new Set(referenced.filter(entry => containsPath(path, entry.directory)).map(entry => entry.build))]
            const complete = blockers.length === 0
            const allowed = recordValid && contentValid && complete && !references.length
            const reason = !recordValid ? "发布记录缺失、损坏或版本不兼容，不能授权删除" : !contentValid ? "依赖源码内容未通过完整校验，不能自动清理" : !complete ? "构建或登记检查不完整，无法确认全部引用" : references.length ? "仍被构建树引用" : "完整且已确认无引用，可清理"
            items.push({ id: `deps-src:${key}`, kind: "deps-src", path, root: entries, ...await storageUsage(path, this.signal), facts, references: { complete, paths: references, blockers: [...blockers] }, cleanup: { allowed, reason }, repairable: recordValid && complete && (contentValid || repairable) })
        }
        const pending = await new TransactionStore(this.user.root, this.user.transactions).list()
        const temporary = join(this.user.dependencySources, "tmp")
        for (const name of await directoryNames(temporary)) {
            const path = join(temporary, name)
            let check: InspectionFact = { state: "incomplete", path, reason: "获取未完成，尚未发布" }
            let allowed = /^[a-f0-9]{64}-[a-f0-9-]{36}$/.test(name) && !pending.length
            try { await assertDirectory(path) } catch (error) {
                check = inspectionFailure(error, path)
                allowed = false
            }
            items.push({ id: `temporary:${name}`, kind: "temporary", path, root: temporary, ...await storageUsage(path, this.signal), facts: [{ label: "content", check }], references: emptyReferences, cleanup: { allowed, reason: pending.length ? "存在用户级事务，请先运行 arrange storage recover" : allowed ? "可识别的获取暂存内容，执行前核验占用" : "无法确认暂存内容归属，需人工检查" } })
        }
        return items
    }
}
