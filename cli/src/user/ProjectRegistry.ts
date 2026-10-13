import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rm } from "node:fs/promises"
import { dirname, join, parse, resolve } from "node:path"
import { z } from "zod"
import { projectRegistrySchema } from "../CliMetadata.ts"
import { withKernelLock } from "../operation/KernelLock.ts"
import { writeAtomicText } from "../util/AtomicFile.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { canonicalResource } from "../operation/Resource.ts"
import type { UserDirectories } from "./UserDirectories.ts"

const schema = z.object({ schema: z.literal(projectRegistrySchema), root: z.string(), volume: z.object({ root: z.string(), device: z.number() }), kind: z.enum(["project", "verification"]), firstSeen: z.string(), lastUsed: z.string(), buildRoots: z.array(z.string()), buildTrees: z.array(z.string()) })
export type ProjectRegistration = z.infer<typeof schema>
export type ProjectAvailability = "present" | "missing" | "unavailable" | "replaced"

export class ProjectRegistry {
    private readonly volumes = new Map<string, ProjectRegistration["volume"]>()
    constructor(private readonly user: UserDirectories, private readonly signal: AbortSignal) { }

    async register(root: string, buildRoot?: string, buildTree?: string): Promise<void> {
        root = (await canonicalResource({ kind: "configuration", path: root, mode: "read" })).path
        const id = createHash("sha256").update(root).digest("hex")
        const volume = await this.volume(root)
        await this.user.ensure(this.user.projects)
        const path = join(this.user.projects, `${id}.json`)
        await withKernelLock(`${path}.kernel`, this.signal, async () => {
            const previous = await this.read(path)
            if (previous && previous.root !== root) throw new Error("工程登记身份不匹配")
            const now = new Date().toISOString()
            const record: ProjectRegistration = { schema: projectRegistrySchema, root, volume, kind: buildTree ? "verification" : previous?.kind ?? "project", firstSeen: previous?.firstSeen ?? now, lastUsed: now, buildRoots: [...new Set([...(previous?.buildRoots ?? []), ...(buildRoot ? [resolve(buildRoot)] : [])])], buildTrees: [...new Set([...(previous?.buildTrees ?? []), ...(buildTree ? [resolve(buildTree)] : [])])] }
            await writeAtomicText(path, `${JSON.stringify(record, null, 4)}\n`, this.signal)
            this.volumes.set(root, volume)
        })
    }

    private async read(path: string): Promise<ProjectRegistration | undefined> {
        try {
            const info = await lstat(path)
            if (!info.isFile() || info.isSymbolicLink()) throw new Error("登记必须为普通文件")
            return schema.parse(JSON.parse(await readFile(path, "utf8")))
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw new Error(`工程登记损坏：${path}`, { cause: error })
        }
    }

    async list(): Promise<readonly { path: string, record?: ProjectRegistration, error?: string }[]> {
        const names = await readdir(this.user.projects).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
            throw error
        })
        await assertPlainDirectoryPath(this.user.root, this.user.projects).catch(error => { if (names.length) throw error })
        return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
            const path = join(this.user.projects, name)
            try {
                if ((await lstat(path)).isSymbolicLink()) throw new Error("登记不能为链接")
                const record = await this.read(path)
                if (record && createHash("sha256").update(record.root).digest("hex") !== name.slice(0, -5)) throw new Error("路径身份不匹配")
                if (record) this.volumes.set(record.root, record.volume)
                return { path, record }
            } catch (error) { return { path, error: String(error) } }
        }))
    }

    async availability(root: string, verification = false): Promise<ProjectAvailability> {
        try { await lstat(parse(resolve(root)).root) } catch { return "unavailable" }
        const identity = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root)
        const volume = this.volumes.get(identity)
        if (volume) try {
            if ((await lstat(volume.root)).dev !== volume.device) return "unavailable"
        } catch { return "unavailable" }
        try {
            const info = await lstat(root)
            if (!info.isDirectory()) return "replaced"
            const config = await lstat(join(root, verification ? "cmake/NativeDependencies.json" : "arrange.project.yaml")).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            return config?.isFile() && !config.isSymbolicLink() ? "present" : "replaced"
        } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable" }
    }

    private async volume(root: string): Promise<ProjectRegistration["volume"]> {
        let existing = root
        let info
        for (; ;) {
            info = await lstat(existing).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (info) break
            const parent = dirname(existing)
            if (parent === existing) throw new Error("无法识别工程所在文件系统")
            existing = parent
        }
        const device = info.dev
        while (existing !== dirname(existing)) {
            const parent = dirname(existing)
            if ((await lstat(parent)).dev !== device) break
            existing = parent
        }
        return { root: existing, device }
    }

    async remove(path: string): Promise<void> {
        await assertPlainDirectoryPath(this.user.root, this.user.projects)
        if (!/^[a-f0-9]{64}\.json$/.test(path.slice(this.user.projects.length + 1))) throw new Error("无效登记路径")
        await withKernelLock(`${path}.kernel`, this.signal, () => rm(path))
    }
}
