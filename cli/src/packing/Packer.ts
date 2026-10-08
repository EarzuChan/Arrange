import { createHash } from "node:crypto"
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { localWorkDirectory } from "../CliMetadata.ts"
import type { Executor } from "../platform/Executor.ts"
import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { ArtifactLocator } from "./ArtifactLocator.ts"
import { MacBundleSigner } from "./MacBundleSigner.ts"
import { uiOutputDirectory, workDirectory } from "../project/ProjectPaths.ts"
import { isJsonObject } from "../util/Utils.ts"

export interface PackOptions {
    readonly flavor: BuildFlavor
    readonly products: readonly NativeProduct[]
    readonly clean?: boolean
}

export interface PackedProduct {
    readonly product: NativeProduct
    readonly path: string
    readonly binaryPath: string
    readonly uiPath: string
}

export interface PackResult {
    readonly directory: string
    readonly products: readonly PackedProduct[]
    readonly manifestPath: string
}

interface Replacement {
    readonly staged: string
    readonly destination: string
    readonly backup: string
    backedUp: boolean
    committed: boolean
}

function contains(parent: string, child: string): boolean {
    const path = relative(parent, child)
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
}

async function canonical(path: string): Promise<string> {
    let ancestor = path
    while (true) {
        try {
            return resolve(await realpath(ancestor), relative(ancestor, path))
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            const parent = dirname(ancestor)
            if (parent === ancestor) throw error
            ancestor = parent
        }
    }
}

async function requireDirectory(path: string, label: string): Promise<void> {
    const info = await lstat(path).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`${label}不存在或不是普通目录：${path}`)
}

async function requirePlainOutputPath(root: string, directory: string): Promise<void> {
    let current = root
    for (const part of relative(root, directory).split(sep).filter(Boolean)) {
        current = resolve(current, part)
        const info = await lstat(current).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            return undefined
        })
        if (info && !info.isDirectory()) throw new Error(`交付路径含有符号链接或非目录：${current}`)
    }
}

async function verifyTree(root: string): Promise<void> {
    const canonicalRoot = await realpath(root)
    const pending = [root]
    while (pending.length) {
        const directory = pending.pop()!
        for (const name of await readdir(directory)) {
            const path = resolve(directory, name)
            const info = await lstat(path)
            if (info.isSymbolicLink()) {
                const target = await realpath(path).catch(() => undefined)
                if (!target || !contains(canonicalRoot, target)) throw new Error(`打包目录包含失效或指向包外的符号链接：${path}`)
            } else if (info.isDirectory()) pending.push(path)
            else if (!info.isFile()) throw new Error(`打包目录包含非普通文件：${path}`)
        }
    }
}

async function digest(path: string): Promise<string> {
    return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function readBuildRecord(path: string): Promise<Record<string, unknown> | undefined> {
    let content: string
    try {
        content = await readFile(path, "utf8")
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw error
    }
    let record: unknown
    try {
        record = JSON.parse(content)
    } catch {
        throw new Error(`CLI 构建记录损坏：${path}`)
    }
    if (!isJsonObject(record)) throw new Error(`CLI 构建记录不是对象：${path}`)
    return record
}

async function matchingBuildRecords(state: ProjectState, options: PackOptions, platform: string, architecture: string) {
    const ui = await readBuildRecord(resolve(workDirectory(state), "built-ui.json"))
    const native = await readBuildRecord(resolve(workDirectory(state), `built-native-${options.flavor}.json`))
    for (const [name, record] of [["UI", ui], ["native", native]] as const) {
        if (!record) continue
        if (record.status !== "completed") throw new Error(`${name} 构建记录未成功完成；请先 arrange build`)
        if (record.projectVersion !== state.project.project.version || record.frameworkVersion !== state.project.framework.version) throw new Error(`${name} 构建记录的项目或 Framework 版本不匹配；请先 arrange build`)
    }
    if (ui && (typeof ui.path !== "string" || resolve(ui.path) !== uiOutputDirectory(state))) throw new Error("UI 构建记录的输出目录不匹配；请先 arrange build --ui-only")
    if (native) {
        if (native.target !== state.project.native.target || typeof native.configuration !== "string" || native.configuration.toLowerCase() !== options.flavor || native.platform !== platform || native.architecture !== architecture) throw new Error("native 构建记录的目标、配置、平台或架构不匹配；请先 arrange build --native-only")
        const products = native.products
        if (!Array.isArray(products) || options.products.some(product => !products.includes(product))) throw new Error("native 构建记录没有覆盖所选 products；请先构建所选产品")
    }
    return {
        ui: ui ? { projectVersion: ui.projectVersion, frameworkVersion: ui.frameworkVersion } : null,
        native: native ? { projectVersion: native.projectVersion, frameworkVersion: native.frameworkVersion, target: native.target, products: native.products } : null,
    }
}

export class Packer {
    private readonly signer: MacBundleSigner

    constructor(private readonly artifactLocator: ArtifactLocator, executor: Executor) {
        this.signer = new MacBundleSigner(executor)
    }

    protected async copy(source: string, destination: string): Promise<void> {
        await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: true, verbatimSymlinks: true })
    }

    protected async move(source: string, destination: string): Promise<void> {
        await rename(source, destination)
    }

    private async checkOutput(state: ProjectState, outputRoot: string, uiDirectory: string): Promise<void> {
        const root = await canonical(resolve(state.rootDir))
        const output = await canonical(outputRoot)
        if (contains(output, root)) throw new Error(`artifacts 目录不能覆盖工程根：${outputRoot}`)
        for (const directory of [uiDirectory, resolve(state.rootDir, state.project.native.directory), resolve(state.rootDir, localWorkDirectory), resolve(state.rootDir, ".git")]) {
            const protectedPath = await canonical(directory)
            if (contains(output, protectedPath) || contains(protectedPath, output)) throw new Error(`artifacts 目录与工程输入或工作目录重叠：${outputRoot} / ${directory}`)
        }
    }

    private async commit(replacements: Replacement[]): Promise<void> {
        try {
            for (const replacement of replacements) {
                if (await lstat(replacement.destination).catch(() => undefined)) {
                    await this.move(replacement.destination, replacement.backup)
                    replacement.backedUp = true
                }
                await this.move(replacement.staged, replacement.destination)
                replacement.committed = true
            }
        } catch (error) {
            const failures: string[] = []
            for (const replacement of [...replacements].reverse()) {
                try {
                    if (replacement.committed) {
                        await rm(replacement.destination, { recursive: true, force: true })
                        replacement.committed = false
                    }
                    if (replacement.backedUp) {
                        await this.move(replacement.backup, replacement.destination)
                        replacement.backedUp = false
                    }
                } catch (failure) {
                    failures.push(`${replacement.destination}：${String(failure)}`)
                }
            }
            if (failures.length) throw new Error(`打包提交失败：${String(error)}；回退未完成，备份仍保留：${failures.join("；")}`)
            throw error
        }
    }

    async pack(state: ProjectState, options: PackOptions): Promise<PackResult> {
        const artifacts = await this.artifactLocator.locate(state, options)
        const uiDirectory = resolve(state.rootDir, state.project.ui.directory)
        const uiDist = uiOutputDirectory(state)
        await requireDirectory(uiDist, "UI dist")
        const entryInfo = await lstat(resolve(uiDist, "app.js")).catch(() => undefined)
        if (!entryInfo?.isFile()) throw new Error(`UI dist 缺少普通文件 app.js：${uiDist}`)
        await verifyTree(uiDist)
        const uiEntrySha256 = await digest(resolve(uiDist, "app.js"))
        const outputRoot = resolve(state.rootDir, state.project.artifacts.directory)
        await this.checkOutput(state, outputRoot, uiDirectory)
        const platform = artifacts[0].platform
        const architecture = artifacts[0].architecture
        if (artifacts.some(artifact => artifact.platform !== platform || artifact.architecture !== architecture)) throw new Error("所选产品的平台或架构不一致")
        const buildRecords = await matchingBuildRecords(state, options, platform, architecture)
        const directory = resolve(outputRoot, options.flavor, ...(state.project.artifacts.includeVersionDirectory ? [state.project.project.version] : []), `${platform === "darwin" ? "macos" : "windows"}-${architecture}`)
        const canonicalDirectory = await canonical(directory)
        if (!contains(await canonical(outputRoot), canonicalDirectory)) throw new Error(`交付路径超出 artifacts：${directory}`)
        await requirePlainOutputPath(outputRoot, directory)
        for (const artifact of artifacts) {
            const source = await canonical(artifact.productPath)
            if (contains(canonicalDirectory, source) || contains(source, canonicalDirectory)) throw new Error(`交付目录与 native 构建产物重叠：${artifact.productPath}`)
            if (artifact.productPath !== artifact.binaryPath) await verifyTree(artifact.productPath)
        }
        if (contains(canonicalDirectory, await canonical(uiDist)) || contains(await canonical(uiDist), canonicalDirectory)) throw new Error("交付目录与 UI dist 重叠")

        await mkdir(directory, { recursive: true })
        const staging = await mkdtemp(resolve(directory, ".arrange-package-"))
        const replacements: Replacement[] = []
        const products: PackedProduct[] = []
        let preserveStaging = false
        try {
            for (const artifact of artifacts) {
                const destination = resolve(directory, artifact.product)
                const staged = resolve(staging, artifact.product)
                const current = await lstat(destination).catch(() => undefined)
                if (current?.isSymbolicLink() || (current && !current.isDirectory())) throw new Error(`交付产品目录不是普通目录：${destination}`)
                await mkdir(staged)
                if (current && !options.clean) {
                    await verifyTree(destination)
                    const replacedNames = new Set([basename(artifact.productPath), "arrange-package.json", ...(artifact.productPath === artifact.binaryPath ? ["ui", ...artifact.runtimeFiles.map(file => basename(file))] : [])])
                    for (const name of await readdir(destination)) if (!replacedNames.has(name)) await this.copy(resolve(destination, name), resolve(staged, name))
                }
                const productPath = resolve(staged, basename(artifact.productPath))
                await this.copy(artifact.productPath, productPath)
                if (artifact.productPath !== artifact.binaryPath) await verifyTree(productPath)
                for (const runtimeFile of artifact.runtimeFiles) {
                    const target = artifact.product === "standalone" ? resolve(staged, basename(runtimeFile)) : resolve(productPath, "Contents", architecture === "x64" ? "x86_64-win" : "arm64-win", basename(runtimeFile))
                    await rm(target, { force: true })
                    await this.copy(runtimeFile, target)
                }
                const uiPath = artifact.productPath === artifact.binaryPath ? resolve(staged, "ui") : resolve(productPath, artifact.uiRelativePath)
                await rm(uiPath, { recursive: true, force: true })
                await mkdir(dirname(uiPath), { recursive: true })
                await this.copy(uiDist, uiPath)
                if (artifact.platform === "darwin") await this.signer.ensureRunnable(artifact.productPath, productPath)
                await verifyTree(staged)
                const binaryRelative = artifact.productPath === artifact.binaryPath ? basename(artifact.binaryPath) : relative(artifact.productPath, artifact.binaryPath)
                const stagedBinary = artifact.productPath === artifact.binaryPath ? productPath : resolve(productPath, binaryRelative)
                const stagedUiEntrySha256 = await digest(resolve(uiPath, "app.js"))
                if (stagedUiEntrySha256 !== uiEntrySha256) throw new Error("UI 复制验证失败")
                const path = resolve(destination, basename(artifact.productPath))
                products.push({ product: artifact.product, path, binaryPath: artifact.productPath === artifact.binaryPath ? path : resolve(path, binaryRelative), uiPath: artifact.productPath === artifact.binaryPath ? resolve(destination, "ui") : resolve(path, artifact.uiRelativePath) })
                await writeFile(resolve(staged, "arrange-package.json"), `${JSON.stringify({ format: 1, project: state.project.project.name, version: state.project.project.version, frameworkVersion: state.project.framework.version, nativeTarget: state.project.native.target, flavor: options.flavor, platform, architecture, product: artifact.product, binary: relative(staged, stagedBinary), ui: relative(staged, uiPath), binarySha256: await digest(stagedBinary), uiEntrySha256: stagedUiEntrySha256, buildRecords }, null, 4)}\n`)
                replacements.push({ staged, destination, backup: resolve(staging, `backup-${artifact.product}`), backedUp: false, committed: false })
            }
            const manifestPath = resolve(directory, "arrange-package.json")
            const stagedManifest = resolve(staging, "arrange-package.json")
            await writeFile(stagedManifest, `${JSON.stringify({ format: 1, project: state.project.project.name, version: state.project.project.version, frameworkVersion: state.project.framework.version, flavor: options.flavor, platform, architecture, buildRecords, products: products.map(product => ({ product: product.product, path: relative(directory, product.path), binary: relative(directory, product.binaryPath), ui: relative(directory, product.uiPath) })) }, null, 4)}\n`)
            replacements.push({ staged: stagedManifest, destination: manifestPath, backup: resolve(staging, "backup-manifest.json"), backedUp: false, committed: false })
            try {
                await this.commit(replacements)
            } catch (error) {
                preserveStaging = String(error).includes("回退未完成")
                if (preserveStaging) throw new Error(`${String(error)}；恢复备份目录：${staging}`)
                throw error
            }
            return { directory, products, manifestPath }
        } finally {
            if (!preserveStaging) await rm(staging, { recursive: true, force: true })
        }
    }
}
