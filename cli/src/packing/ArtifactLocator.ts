import { lstat, realpath } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path"
import type { CmakeService, CmakeModel } from "../cmake/CmakeService.ts"
import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"

export interface ArtifactLocateOptions {
    readonly flavor: BuildFlavor
    readonly products: readonly NativeProduct[]
}

export interface ProductArtifact {
    readonly product: NativeProduct
    readonly target: string
    readonly binaryPath: string
    readonly productPath: string
    readonly resourceRoot: string
    readonly uiRelativePath: string
    readonly runtimeFiles: readonly string[]
    readonly platform: "darwin" | "win32"
    readonly architecture: "x64" | "arm64"
    readonly configuration: string
}

function isInside(parent: string, child: string): boolean {
    const path = relative(parent, child)
    return path === "" || (!isAbsolute(path) && !path.startsWith(`..${sep}`) && path !== "..")
}

function enclosingBundle(binaryPath: string, extension: string): string {
    for (let directory = dirname(binaryPath); ; directory = dirname(directory)) {
        if (extname(directory).toLowerCase() === extension) return directory
        if (dirname(directory) === directory) throw new Error(`产物不在完整 ${extension} bundle 中：${binaryPath}`)
    }
}

async function requireFile(path: string, label: string): Promise<void> {
    const info = await lstat(path).catch(() => undefined)
    if (!info?.isFile()) throw new Error(`${label}不存在或不是普通文件：${path}`)
}

async function runtimeLibraries(model: CmakeModel, targetName: string): Promise<string[]> {
    if (model.platform !== "win32") return []
    const targets = new Map(model.targets.map(target => [target.name, target]))
    const pending = [targetName]
    const visited = new Set<string>()
    const libraries = new Map<string, string>()
    while (pending.length) {
        const name = pending.pop()!
        if (visited.has(name)) continue
        visited.add(name)
        const target = targets.get(name)
        if (!target) continue
        pending.push(...target.dependencies)
        if (target.type !== "SHARED_LIBRARY") continue
        for (const path of target.artifacts.filter(path => extname(path).toLowerCase() === ".dll")) {
            await requireFile(path, "运行依赖")
            const key = basename(path).toLowerCase()
            const previous = libraries.get(key)
            if (previous && previous !== path) throw new Error(`运行依赖文件名冲突：${previous} / ${path}`)
            libraries.set(key, path)
        }
    }
    return [...libraries.values()]
}

export class ArtifactLocator {
    constructor(private readonly cmakeService: CmakeService) { }

    async locate(state: ProjectState, options: ArtifactLocateOptions): Promise<ProductArtifact[]> {
        if (!options.products.length) throw new Error("至少选择一个 native product")
        const products = [...new Set(options.products)]
        for (const product of products) {
            if (!state.project.project.products.includes(product)) throw new Error(`工程未启用 ${product}`)
        }
        const inspected = await this.cmakeService.inspect(state, options.flavor)
        if (!inspected.ready) throw new Error(`native 准备状态失效：${inspected.reason ?? "请先 arrange sync --setup"}`)
        const model = inspected.model ?? await this.cmakeService.readModel(state, options.flavor)
        if (model.configuration.toLowerCase() !== options.flavor) throw new Error(`构建配置不符：需要 ${options.flavor}，实际为 ${model.configuration}`)
        if (state.local?.native && model.architecture !== state.local.native.architecture) throw new Error(`构建架构不符：需要 ${state.local.native.architecture}，实际为 ${model.architecture}`)
        const records = this.cmakeService.productArtifacts(state, model, products)
        const located: ProductArtifact[] = []
        for (const record of records) {
            const candidates = record.paths.filter(path => model.platform !== "win32" || extname(path).toLowerCase() === (record.product === "standalone" ? ".exe" : ".vst3"))
            const binaries: string[] = []
            for (const path of candidates) {
                const info = await lstat(path).catch(() => undefined)
                if (info?.isFile()) binaries.push(resolve(path))
            }
            if (binaries.length !== 1) throw new Error(`${record.target} 应有一个已构建的运行二进制，实际找到 ${binaries.length} 个；请先 arrange build`)
            const binaryPath = binaries[0]
            let productPath = binaryPath
            let resourceRoot = dirname(binaryPath)
            let uiRelativePath = "ui"
            if (record.product === "vst3" || model.platform === "darwin") {
                productPath = enclosingBundle(binaryPath, record.product === "vst3" ? ".vst3" : ".app")
                const info = await lstat(productPath)
                if (!info.isDirectory()) throw new Error(`bundle 不是普通目录：${productPath}`)
                const parts = relative(productPath, binaryPath).split(sep)
                const expectedDirectory = model.platform === "darwin" ? "MacOS" : `${model.architecture === "x64" ? "x86_64" : "arm64"}-win`
                if (parts.length !== 3 || parts[0] !== "Contents" || parts[1] !== expectedDirectory) throw new Error(`bundle 内运行二进制布局或架构不符：${binaryPath}`)
                if (!isInside(await realpath(productPath), await realpath(binaryPath))) throw new Error(`bundle 二进制指向包外：${binaryPath}`)
                if (model.platform === "darwin") await requireFile(resolve(productPath, "Contents/Info.plist"), "bundle Info.plist")
                resourceRoot = resolve(productPath, "Contents/Resources")
                uiRelativePath = "Contents/Resources/ui"
            }
            located.push({ product: record.product, target: record.target, binaryPath, productPath, resourceRoot, uiRelativePath, runtimeFiles: await runtimeLibraries(model, record.target), platform: model.platform, architecture: model.architecture, configuration: model.configuration })
        }
        return located
    }

    async locateStandalone(state: ProjectState, flavor: BuildFlavor): Promise<ProductArtifact> {
        return (await this.locate(state, { flavor, products: ["standalone"] }))[0]
    }
}
