import { lstat, readFile, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { z } from "zod"
import type { UserDirectories } from "../user/UserDirectories.ts"
import { ProjectRegistry } from "../user/ProjectRegistry.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { containsPath } from "../transaction/TreeState.ts"
import { sourceRecordSchema } from "../source/SourceCache.ts"
import { sourceHash } from "../source/SourceSpec.ts"
import { sourceReferencesFileName, nativeVerificationFileName, nativeVerificationSchema } from "../CliMetadata.ts"
import { buildReferencesSchema } from "../source/BuildReferences.ts"
import type { GitSource } from "../source/GitSource.ts"

export interface StorageItem {
    readonly id: string
    readonly kind: "project" | "build" | "source" | "temporary"
    readonly path: string
    readonly root: string
    readonly status: string
    readonly owner?: string
    readonly bytes: number
    readonly sizeComplete: boolean
    readonly cleanable: boolean
    readonly references: readonly string[]
    readonly referencesComplete?: boolean
    readonly ownershipConfirmed?: boolean
}
const ownerSchema = z.object({ rootDir: z.string() })

async function names(path: string): Promise<string[]> {
    try { return await readdir(path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
    }
}

async function usage(path: string): Promise<{ bytes: number, sizeComplete: boolean }> {
    let bytes = 0
    let sizeComplete = true
    async function visit(current: string): Promise<void> {
        try {
            const info = await lstat(current)
            if (info.isSymbolicLink()) return
            if (info.isDirectory()) for (const name of await readdir(current)) await visit(join(current, name))
            else if (info.isFile()) bytes += info.size
        } catch { sizeComplete = false }
    }
    await visit(path)
    return { bytes, sizeComplete }
}

export class StorageInventory {
    constructor(private readonly user: UserDirectories, private readonly projects: ProjectRegistry, private readonly git: Pick<GitSource, "verify">, private readonly signal: AbortSignal) { }

    async inspect(): Promise<readonly StorageItem[]> {
        const items: StorageItem[] = []
        const registrations = await this.projects.list()
        const roots = new Set([this.user.builds])
        let uncertain = registrations.some(entry => entry.error)
        for (const entry of registrations) {
            if (entry.record) {
                entry.record.buildRoots.forEach(root => roots.add(root))
                const status = await this.projects.availability(entry.record.root, entry.record.kind === "verification")
                items.push({ id: `project:${entry.path.split(/[\\/]/).at(-1)!.slice(0, -5)}`, kind: "project", path: entry.record.root, root: this.user.projects, owner: entry.path, status, bytes: 0, sizeComplete: true, cleanable: false, references: [] })
                if (status === "unavailable") uncertain = true
            } else items.push({ id: `project:${entry.path}`, kind: "project", path: entry.path, root: this.user.projects, status: entry.error!, bytes: 0, sizeComplete: false, cleanable: false, references: [] })
        }
        const referenced: { directory: string, build: string }[] = []
        for (const entry of registrations) if (entry.record) for (const build of entry.record.buildTrees) {
            const info = await lstat(build).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                uncertain = true
                return undefined
            })
            if (!info) continue
            try {
                if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("验收树不是普通目录")
                const owner = z.object({ version: z.literal(nativeVerificationSchema), source: z.string(), identity: z.string(), complete: z.boolean() }).parse(JSON.parse(await readFile(join(build, nativeVerificationFileName), "utf8")))
                if (!containsPath(entry.record.root, owner.source) && owner.source !== entry.record.root) throw new Error("验收树归属不符")
                const refs = buildReferencesSchema.parse(JSON.parse(await readFile(join(build, sourceReferencesFileName), "utf8")))
                for (const directory of refs.directories) referenced.push({ directory, build })
                const status = await this.projects.availability(entry.record.root, true)
                items.push({ id: `build:${createHash("sha256").update(build).digest("hex").slice(0, 16)}`, kind: "build", root: dirname(build), path: build, owner: entry.record.root, status, ...await usage(build), cleanable: status === "missing" || status === "replaced", references: [], ownershipConfirmed: true })
            } catch { uncertain = true }
        }
        for (const root of roots) {
            let bases: string[]
            try {
                bases = await names(root)
                if (bases.length) await assertPlainDirectoryPath(root, root)
            } catch {
                uncertain = true
                continue
            }
            for (const name of bases.filter(name => !/^[a-f0-9]{8}$/.test(name))) {
                const path = join(root, name)
                uncertain = true
                items.push({ id: `build:${createHash("sha256").update(path).digest("hex").slice(0, 16)}`, kind: "build", path, root, status: "未知构建内容，不自动清理", ...await usage(path), cleanable: false, references: [] })
            }
            for (const name of bases.filter(name => /^[a-f0-9]{8}$/.test(name))) {
                const base = join(root, name)
                let owner: string | undefined
                let availability = "unknown"
                try {
                    await assertPlainDirectoryPath(root, base)
                    owner = ownerSchema.parse(JSON.parse(await readFile(join(base, "owner.json"), "utf8"))).rootDir
                    const normalized = process.platform === "win32" ? resolve(owner).toLowerCase() : resolve(owner)
                    if (createHash("sha256").update(normalized).digest("hex").slice(0, 8) !== name) throw new Error("构建树哈希与 owner 不符")
                    availability = await this.projects.availability(owner)
                    for (const configuration of await names(base)) {
                        if (!/^(?:mac-)?[ax][dr]$/.test(configuration)) continue
                        const build = join(base, configuration)
                        await assertPlainDirectoryPath(root, build)
                        const refs = buildReferencesSchema.parse(JSON.parse(await readFile(join(build, sourceReferencesFileName), "utf8")))
                        for (const directory of refs.directories) referenced.push({ directory: resolve(directory), build })
                    }
                } catch {
                    uncertain = true
                    availability = "unknown"
                }
                if (availability === "unavailable") uncertain = true
                items.push({ id: `build:${createHash("sha256").update(base).digest("hex").slice(0, 16)}`, kind: "build", path: base, root, owner, status: availability, ...await usage(base), cleanable: availability === "missing" || availability === "replaced", references: [], ownershipConfirmed: availability !== "unknown" })
            }
        }
        const entries = join(this.user.sources, "entries")
        for (const key of (await names(entries)).filter(key => /^[a-f0-9]{16}$/.test(key))) {
            const path = join(entries, key)
            let status = "完整"
            let valid = true
            try {
                await assertPlainDirectoryPath(this.user.root, path)
                const record = sourceRecordSchema.parse(JSON.parse(await readFile(join(path, "complete.json"), "utf8")))
                if (record.key !== key || record.source.commit !== record.commit || sourceHash([record.source.repository, record.commit]) !== record.contentIdentity || record.contentIdentity.slice(0, 16) !== key) throw new Error("源码身份不符")
                await assertPlainDirectoryPath(this.user.root, join(path, "source", ".git"))
                const head = (await readFile(join(path, "source", ".git", "HEAD"), "utf8")).trim()
                if (head !== record.commit) {
                    status = "源码损坏"
                    valid = false
                }
            } catch {
                status = "记录或源码损坏"
                valid = false
            }
            if (valid) try { await this.git.verify(join(path, "source"), this.signal) } catch (error) {
                this.signal.throwIfAborted()
                status = `源码损坏或无法验证：${String(error)}`
                valid = false
            }
            const references = referenced.filter(entry => containsPath(path, entry.directory)).map(entry => entry.build)
            if (uncertain) status += "；构建引用无法完整确认"
            items.push({ id: `source:${key}`, kind: "source", path, root: entries, status, ...await usage(path), cleanable: valid && !uncertain && !references.length, references, referencesComplete: !uncertain })
        }
        const temporary = join(this.user.sources, "tmp")
        for (const name of await names(temporary)) {
            const path = join(temporary, name)
            items.push({ id: `temporary:${name}`, kind: "temporary", path, root: temporary, status: "获取临时内容，执行前核验占用", ...await usage(path), cleanable: /^[a-f0-9]{64}-[a-f0-9-]{36}$/.test(name), references: [] })
        }
        return items
    }
}
