import { randomUUID } from "node:crypto"
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { sourceCacheSchema } from "../../CliMetadata.ts"
import { UserDirectories } from "../user/UserDirectories.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import type { TaskOutput } from "../operation/Work.ts"
import { GitSource } from "./GitSource.ts"
import { sourceHash, sourceIdentity, sourceRepositoryIdentity, sourceSpecSchema, type SourceSpec } from "./SourceSpec.ts"
import type { Operations } from "../operation/Operations.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { readCurrentRecord, InspectionError } from "../../util/RecordInspection.ts"

export const sourceRecordSchema = z.object({ schema: z.literal(sourceCacheSchema), identity: z.string().regex(/^[a-f0-9]{64}$/), key: z.string().regex(/^[a-f0-9]{16}$/), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i), source: sourceSpecSchema })
const recordSchema = sourceRecordSchema
type SourceRecord = z.infer<typeof recordSchema>
export function assertSourceRecordIdentity(record: SourceRecord, path: string): void {
    if (record.source.commit !== record.commit || sourceHash([record.source.repository, record.commit]) !== record.contentIdentity || record.contentIdentity.slice(0, 16) !== record.key) throw new InspectionError({ state: "damaged", path, reason: "依赖源码记录的来源、commit 与内容身份不匹配" })
}
export async function readSourceRecord(path: string): Promise<SourceRecord> {
    const record = await readCurrentRecord(path, sourceRecordSchema, { field: "schema", supported: sourceCacheSchema })
    assertSourceRecordIdentity(record, path)
    return record
}
export interface CachedSource { readonly directory: string, readonly commit: string, readonly key: string }

export class SourceCache {
    private readonly verified = new Map<string, Promise<void>>()

    constructor(private readonly directories: UserDirectories, private readonly git: Pick<GitSource, "checkout" | "verify">, private readonly signal: AbortSignal, private readonly operations: Pick<Operations, "source">) { }

    private get requests(): string { return join(this.directories.dependencySources, "requests") }
    private get entries(): string { return join(this.directories.dependencySources, "entries") }
    private get staging(): string { return join(this.directories.dependencySources, "tmp") }
    private get locks(): string { return join(this.directories.dependencySources, "locks") }

    private async readRecord(path: string): Promise<SourceRecord | undefined> {
        try {
            const info = await lstat(path)
            if (!info.isFile() || info.isSymbolicLink()) throw new Error("源码记录必须为普通文件")
            return await readSourceRecord(path)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw new Error(`共享依赖源码缓存记录损坏或版本不支持：${path}；请人工检查，不自动迁移旧格式`, { cause: error })
        }
    }

    async find(spec: SourceSpec): Promise<CachedSource | undefined> {
        sourceSpecSchema.parse(spec)
        try { await access(this.directories.root) } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw error
        }
        await assertPlainDirectoryPath(this.directories.root, this.requests)
        const identity = sourceIdentity(spec)
        if (spec.commit) {
            const commit = spec.commit.toLowerCase()
            const contentIdentity = sourceHash([sourceRepositoryIdentity(spec.repository), commit])
            const pinned = await this.entry({ key: contentIdentity.slice(0, 16), contentIdentity, commit })
            if (pinned) return pinned
        }
        const record = await this.readRecord(join(this.requests, `${identity}.json`))
        if (!record) return undefined
        if (record.identity !== identity || (spec.commit && record.commit.toLowerCase() !== spec.commit.toLowerCase()) || record.contentIdentity !== sourceHash([sourceRepositoryIdentity(spec.repository), record.commit]) || record.key !== record.contentIdentity.slice(0, 16)) throw new Error("共享依赖源码缓存身份不匹配")
        return this.entry(record)
    }

    private async entry(record: Pick<SourceRecord, "key" | "commit" | "contentIdentity">): Promise<CachedSource | undefined> {
        const directory = join(this.entries, record.key)
        await assertPlainDirectoryPath(this.directories.root, join(directory, "source"))
        const marker = await this.readRecord(join(directory, "complete.json"))
        if (!marker) {
            try { await access(directory) } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            }
            throw new Error(`共享依赖源码缓存缺少发布记录：${directory}`)
        }
        if (marker.contentIdentity !== record.contentIdentity || marker.key !== record.key || marker.commit !== record.commit) throw new Error(`共享依赖源码缓存条目身份不匹配：${directory}`)
        try {
            await access(join(directory, "source", "CMakeLists.txt"))
            const head = (await readFile(join(directory, "source", ".git", "HEAD"), "utf8")).trim()
            if (head !== record.commit) throw new Error(`共享依赖源码缓存 checkout 已被修改：${directory}`)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`共享依赖源码缓存内容缺失：${directory}`, { cause: error })
            throw error
        }
        return { directory: join(directory, "source"), key: record.key, commit: record.commit }
    }

    private async verify(source: CachedSource): Promise<void> {
        let verification = this.verified.get(source.key)
        if (!verification) {
            verification = this.git.verify(source.directory, this.signal)
            this.verified.set(source.key, verification)
            verification.catch(() => this.verified.delete(source.key))
        }
        await verification
        this.signal.throwIfAborted()
    }

    async ensure(spec: SourceSpec, label: string, task: TaskOutput, validate?: (source: CachedSource) => Promise<void>): Promise<CachedSource> {
        this.signal.throwIfAborted()
        const present = await this.find(spec)
        if (present) {
            await this.verify(present)
            await validate?.(present)
            task.line(`复用 ${label} 源码 · ${spec.ref} · ${present.commit.slice(0, 12)}`)
            return present
        }
        for (const directory of [this.requests, this.entries, this.staging, this.locks]) await this.directories.ensure(directory)
        const identity = sourceIdentity(spec)
        task.stage(`准备 ${label} 源码`)
        return this.operations.source(join(this.locks, identity), `获取 ${label} 源码`, async signal => {
            const ready = await this.find(spec)
            if (ready) {
                await this.verify(ready)
                await validate?.(ready)
                task.line(`复用 ${label} 源码 · ${spec.ref} · ${ready.commit.slice(0, 12)}`)
                return ready
            }
            // 相同请求的锁已取得，上一持有者留下的临时内容不可能仍在使用
            for (const name of await readdir(this.staging)) if (name.startsWith(`${identity}-`)) {
                const abandoned = join(this.staging, name)
                await assertPlainDirectoryPath(this.directories.root, abandoned)
                await rm(abandoned, { recursive: true, force: true })
            }
            const temporary = join(this.staging, `${identity}-${randomUUID()}`)
            await mkdir(join(temporary, "source"), { recursive: true })
            try {
                task.line(`获取 ${label} 源码 · ${spec.ref}`)
                const commit = await this.git.checkout(spec, join(temporary, "source"), task, signal)
                signal.throwIfAborted()
                await access(join(temporary, "source", "CMakeLists.txt"))
                const repository = sourceRepositoryIdentity(spec.repository)
                const contentIdentity = sourceHash([repository, commit])
                const record = recordSchema.parse({ schema: sourceCacheSchema, identity, key: contentIdentity.slice(0, 16), contentIdentity, commit, source: { repository, ref: spec.ref, commit } })
                await this.operations.source(join(this.locks, record.key), `发布 ${label} 源码`, async publishSignal => {
                    const existing = await this.entry(record)
                    if (existing) await this.verify(existing)
                    await validate?.(existing ?? { directory: join(temporary, 'source'), commit, key: record.key })
                    publishSignal.throwIfAborted()
                    if (!existing) {
                        await writeFile(join(temporary, "complete.json"), `${JSON.stringify(record, null, 4)}\n`)
                        await rename(temporary, join(this.entries, record.key))
                    }
                }, text => task.waiting(text))
                signal.throwIfAborted()
                const request = join(this.requests, `${identity}.json`)
                await writeAtomicText(request, `${JSON.stringify(record, null, 4)}\n`, signal)
                return (await this.entry(record))!
            } finally {
                await assertPlainDirectoryPath(this.directories.root, temporary)
                await rm(temporary, { recursive: true, force: true })
            }
        }, text => task.waiting(text))
    }
}
