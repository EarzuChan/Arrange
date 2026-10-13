import { lstat, readFile, readdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import type { CmakeService } from "../cmake/CmakeService.ts"
import type { BuildFlavor, ProjectState } from "../project/ProjectState.ts"
import { nativeDirectory, safeUiOutputDirectory, uiDirectory, workDirectory } from "../project/ProjectPaths.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { containsPath } from "../transaction/TreeState.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { DeleteTransaction } from "../transaction/DeleteTransaction.ts"
import { nativeBuildRecordName } from "../building/BuildReceipt.ts"
import { defaultNativeGenerator } from "../CliMetadata.ts"

export interface CleanOptions { readonly ui: boolean, readonly native: boolean, readonly artifacts: boolean, readonly flavor?: BuildFlavor }
export interface CleanEntry { readonly root: string, readonly path: string, readonly reason: string }
const manifestSchema = z.object({ format: z.literal(1), project: z.string(), nativeTarget: z.string(), platform: z.string(), architecture: z.string(), ownedEntries: z.array(z.string()) })

export class ProjectCleaner {
    constructor(private readonly cmake: Pick<CmakeService, "buildDirectory" | "buildAnchor">, private readonly signal: AbortSignal) { }

    async plan(state: ProjectState, options: CleanOptions): Promise<readonly CleanEntry[]> {
        const transactions = await new TransactionStore(state.rootDir).list()
        if (transactions.some(entry => entry.error || entry.record?.status !== "complete")) throw new Error("工程存在未完成或损坏事务，请先运行 arrange recover")
        const entries: CleanEntry[] = []
        if (options.ui) {
            const path = await safeUiOutputDirectory(state)
            const protectedPaths = [state.rootDir, nativeDirectory(state), workDirectory(state), resolve(state.rootDir, state.project.artifacts.directory)]
            if (protectedPaths.some(protectedPath => containsPath(path, protectedPath) || containsPath(protectedPath, path) && protectedPath !== state.rootDir)) throw new Error("UI 输出与保护目录重叠")
            entries.push({ root: uiDirectory(state), path, reason: "UI 构建输出" }, { root: state.rootDir, path: join(workDirectory(state), "built-ui.json"), reason: "UI 构建凭据" })
        }
        if (options.native) {
            const prepared = state.local?.native ? state : { ...state, local: { ...state.local, native: { generator: defaultNativeGenerator, architecture: process.arch === "arm64" ? "arm64" as const : "x64" as const } } }
            for (const flavor of options.flavor ? [options.flavor] : ["debug", "release"] as const) {
                const path = this.cmake.buildDirectory(prepared, flavor)
                const root = this.cmake.buildAnchor(prepared)
                const ownerPath = join(dirname(path), "owner.json")
                const info = await lstat(path).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                    throw error
                })
                if (info) {
                    await assertPlainDirectoryPath(root, path)
                    const owner = z.object({ rootDir: z.string() }).parse(JSON.parse(await readFile(ownerPath, "utf8")))
                    const normalize = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value)
                    if (normalize(owner.rootDir) !== normalize(state.rootDir)) throw new Error(`构建归属不符：${path}`)
                    entries.push({ root, path, reason: `原生 ${flavor} 构建树` })
                }
                entries.push({ root: state.rootDir, path: join(workDirectory(state), `built-${nativeBuildRecordName(prepared, flavor, process.platform as "win32" | "darwin")}.json`), reason: `原生 ${flavor} 构建凭据` })
            }
        }
        if (options.artifacts) entries.push(...await this.artifacts(state))
        const existing: CleanEntry[] = []
        for (const entry of entries) {
            const info = await lstat(entry.path).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (info) {
                if (info.isSymbolicLink()) throw new Error(`清理目标不能为链接：${entry.path}`)
                existing.push(entry)
            }
        }
        const unique = [...new Map(existing.map(entry => [entry.path, entry])).values()]
        return unique.filter(entry => !unique.some(other => other !== entry && containsPath(other.path, entry.path)))
    }

    async execute(state: ProjectState, entries: readonly CleanEntry[]): Promise<void> {
        const transaction = new DeleteTransaction(new TransactionStore(state.rootDir), this.signal)
        await transaction.apply(await transaction.prepare(entries))
    }

    private async artifacts(state: ProjectState): Promise<CleanEntry[]> {
        const root = resolve(state.rootDir, state.project.artifacts.directory)
        if (!containsPath(state.rootDir, root) || root === state.rootDir || [uiDirectory(state), nativeDirectory(state), workDirectory(state)].some(path => containsPath(root, path) || containsPath(path, root))) throw new Error("交付目录与保护目录重叠")
        const result: CleanEntry[] = []
        const pending = [{ path: root, depth: 0 }]
        while (pending.length) {
            const { path, depth } = pending.pop()!
            const info = await lstat(path).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (!info) continue
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`交付目录含链接或文件：${path}`)
            await assertPlainDirectoryPath(state.rootDir, path)
            if (["standalone", "vst3"].includes(basename(path))) {
                const manifestPath = join(path, "arrange-package.json")
                const content = await readFile(manifestPath, "utf8").catch(error => {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                    throw error
                })
                if (!content) continue
                const manifest = manifestSchema.parse(JSON.parse(content))
                if (manifest.project !== state.project.project.name || manifest.nativeTarget !== state.project.native.target) throw new Error(`交付物归属不符：${manifestPath}`)
                if (manifest.platform !== process.platform || manifest.architecture !== state.local?.native?.architecture) continue
                for (const name of manifest.ownedEntries) {
                    if (name !== basename(name) || name === "." || name === ".." || !name) throw new Error("交付清单包含越界入口")
                    result.push({ root, path: join(path, name), reason: "受管交付入口" })
                }
                result.push({ root, path: manifestPath, reason: "产品清单" })
                // 总清单只在对应本机产品清理时移除，不遍历包内用户内容
                const aggregate = join(dirname(path), "arrange-package.json")
                if (!result.some(entry => entry.path === aggregate)) result.push({ root, path: aggregate, reason: "交付总清单" })
            } else if (depth < 4) for (const name of await readdir(path)) if (name !== "arrange-package.json" && !name.startsWith(".arrange-")) {
                const child = join(path, name)
                if ((await lstat(child)).isDirectory() || (await lstat(child)).isSymbolicLink()) pending.push({ path: child, depth: depth + 1 })
            }
        }
        return result
    }
}
