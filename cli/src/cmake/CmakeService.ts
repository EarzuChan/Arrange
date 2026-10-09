import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { cmakePreparationFileName, cmakeQueryClientName, localWorkDirectory, nativeBuildDirectoryName, nativeIconCmakeDefinitions, nativeIconDirectory, productTargetSuffixes } from "../CliMetadata.ts"
import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { Executor } from "../platform/Executor.ts"
import type { PlatformService } from "../platform/PlatformService.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { IconAssetsService } from "../asset/IconAssetsService.ts"
import { nativePresentationSignature } from "../project/NativePresentation.ts"
import { isAbortError, throwIfProcessCancelled } from "../platform/ProcessSpec.ts"

export interface CmakeTarget {
    readonly name: string
    readonly type: string
    readonly artifacts: readonly string[]
    readonly dependencies: readonly string[]
}

export interface CmakeModel {
    readonly sourceDirectory: string
    readonly buildDirectory: string
    readonly configuration: string
    readonly platform: "darwin" | "win32"
    readonly architecture: "x64" | "arm64"
    readonly targets: readonly CmakeTarget[]
}

export interface ProductArtifacts {
    readonly product: NativeProduct
    readonly target: string
    readonly paths: readonly string[]
}

export interface CmakeInspection {
    readonly ready: boolean
    readonly reason?: string
    readonly model?: CmakeModel
}

interface Preparation {
    readonly signature: string
    readonly inputHashes: Record<string, string>
}

interface ReplyIndex {
    readonly reply: Record<string, Record<string, { jsonFile?: string, error?: string }>>
}

interface CodeModelReply {
    readonly paths: { source: string, build: string }
    readonly configurations: readonly { name: string, targets: readonly { name: string, id: string, jsonFile: string }[] }[]
}

interface TargetReply {
    readonly name: string
    readonly type: string
    readonly artifacts?: readonly { path: string }[]
    readonly dependencies?: readonly { id: string }[]
}

interface CmakeFilesReply {
    readonly paths: { source: string }
    readonly inputs: readonly { path: string, isGenerated?: boolean, isExternal?: boolean }[]
}

function hash(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex")
}

export class CmakeService {
    constructor(private readonly executor: Executor, private readonly platform: PlatformService, private readonly icons: IconAssetsService) { }

    buildDirectory(state: ProjectState, flavor: BuildFlavor): string {
        const arch = state.local?.native?.architecture
        if (!arch) throw new Error("本机 native 工具环境尚未准备，请先运行 arrange sync --setup")
        return resolve(state.rootDir, localWorkDirectory, nativeBuildDirectoryName, `${this.platform.name === "darwin" ? "mac" : "win"}-${arch}`, flavor)
    }

    async inspect(state: ProjectState, flavor: BuildFlavor): Promise<CmakeInspection> {
        try {
            await assertPlainDirectoryPath(state.rootDir, this.buildDirectory(state, flavor))
            const preparation = JSON.parse(await readFile(this.preparationPath(state, flavor), "utf8")) as Preparation
            if (preparation.signature !== await this.signature(state, flavor)) return { ready: false, reason: "原生配置或本机工具环境已变化，需要重新 configure" }
            const iconInspection = await this.icons.inspect(state, this.iconDirectory(state, flavor))
            if (!iconInspection.ready) return { ready: false, reason: iconInspection.reason }
            const cache = await readFile(join(this.buildDirectory(state, flavor), "CMakeCache.txt"), "utf8")
            if (!cache.includes(`CMAKE_GENERATOR:INTERNAL=${state.local!.native!.generator}`)) return { ready: false, reason: "CMake 构建缓存与本机生成器不符" }
            for (const [path, previous] of Object.entries(preparation.inputHashes)) if (hash(await readFile(path)) !== previous) return { ready: false, reason: `CMake 输入已变化：${path}` }
            const model = await this.readModel(state, flavor)
            this.productArtifacts(state, model, state.project.project.products)
            return { ready: true, model }
        } catch (error) {
            if (isAbortError(error)) throw error
            return { ready: false, reason: error instanceof Error ? error.message : String(error) }
        }
    }

    async configure(state: ProjectState, flavor: BuildFlavor): Promise<CmakeModel> {
        const local = state.local
        if (!local?.cmake || !local.nativeCompiler || !local.native) throw new Error("原生工具配置不完整，请先运行 arrange sync --setup")
        const directory = this.buildDirectory(state, flavor)
        await assertPlainDirectoryPath(state.rootDir, directory)
        await this.resetIncompatibleTree(state, flavor)
        await rm(this.preparationPath(state, flavor), { force: true })
        const signature = await this.signature(state, flavor)
        const presentation = await this.presentationSignature(state)
        const icons = await this.icons.prepare(state, this.iconDirectory(state, flavor))
        const query = join(directory, ".cmake", "api", "v1", "query", `client-${cmakeQueryClientName}`)
        await assertPlainDirectoryPath(state.rootDir, query)
        await mkdir(query, { recursive: true })
        for (const kind of ["codemodel-v2", "cmakeFiles-v1"]) await writeFile(join(query, kind), "")
        const args = ["-S", resolve(state.rootDir, state.project.native.directory), "-B", directory, "-G", local.native.generator]
        if (!local.native.generator.startsWith("Visual Studio") && local.native.generator !== "Xcode" && local.native.generator !== "Ninja Multi-Config") args.push(`-DCMAKE_BUILD_TYPE=${this.configuration(flavor)}`)
        if (local.native.generator.startsWith("Ninja")) {
            if (!local.ninja) throw new Error("Ninja 路径未配置")
            args.push(`-DCMAKE_MAKE_PROGRAM=${local.ninja.path}`)
        }
        if (this.platform.name === "darwin") {
            args.push(`-DCMAKE_CXX_COMPILER=${local.nativeCompiler.path}`, `-DCMAKE_C_COMPILER=${join(dirname(local.nativeCompiler.path), "clang")}`, `-DCMAKE_OSX_ARCHITECTURES=${local.native.architecture === "x64" ? "x86_64" : "arm64"}`)
        } else if (local.native.generator.startsWith("Visual Studio")) args.push("-A", local.native.architecture === "x64" ? "x64" : "ARM64")
        else args.push(`-DCMAKE_C_COMPILER=${local.nativeCompiler.path}`, `-DCMAKE_CXX_COMPILER=${local.nativeCompiler.path}`)
        args.push(`-D${nativeIconCmakeDefinitions.ico}=${icons?.ico.replace(/\\/g, "/") ?? ""}`, `-D${nativeIconCmakeDefinitions.icns}=${icons?.icns.replace(/\\/g, "/") ?? ""}`, `-D${nativeIconCmakeDefinitions.presentation}=${presentation}`)
        const reserved = new Set([...Object.values(nativeIconCmakeDefinitions), "CMAKE_BUILD_TYPE", "CMAKE_GENERATOR", "CMAKE_GENERATOR_PLATFORM", "CMAKE_MAKE_PROGRAM", "CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER", "CMAKE_OSX_ARCHITECTURES"])
        for (const [key, value] of Object.entries(local.native.cmakeDefinitions ?? {})) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || reserved.has(key) || /[\r\n\0]/.test(value)) throw new Error(`不支持的 CMake 自定义选项：${key}`)
            args.push(`-D${key}=${value}`)
        }
        const env = await this.platform.nativeEnvironment(local)
        const result = await this.executor.run({ command: local.cmake.path, args, cwd: state.rootDir, env, onStdout: text => process.stdout.write(text), onStderr: text => process.stderr.write(text) })
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`CMake configure 未成功（${result.exitCode}）${result.cancelled ? "：已取消" : result.timedOut ? "：超时" : ""}`)
        const model = await this.readModel(state, flavor)
        this.productArtifacts(state, model, state.project.project.products)
        const inputHashes = await this.inputHashes(state, flavor)
        if (signature !== await this.signature(state, flavor)) throw new Error("原生配置或图标源在 configure 期间发生变化，请重新运行 native SETUP")
        const iconInspection = await this.icons.inspect(state, this.iconDirectory(state, flavor))
        if (!iconInspection.ready) throw new Error(iconInspection.reason ?? "图标派生资源尚未准备")
        await writeFile(this.preparationPath(state, flavor), `${JSON.stringify({ signature, inputHashes }, null, 4)}\n`)
        return model
    }

    async readModel(state: ProjectState, flavor: BuildFlavor): Promise<CmakeModel> {
        const directory = this.buildDirectory(state, flavor)
        await assertPlainDirectoryPath(state.rootDir, directory)
        await this.assertCacheArchitecture(state, flavor)
        const codemodel = await this.readReply<CodeModelReply>(directory, "codemodel-v2")
        if (resolve(codemodel.paths.source) !== resolve(state.rootDir, state.project.native.directory) || resolve(codemodel.paths.build) !== directory) throw new Error("CMake 查询模型的源码或构建目录不匹配")
        const configuration = codemodel.configurations.find(item => item.name === this.configuration(flavor))
        if (!configuration) throw new Error(`CMake 模型缺少 ${this.configuration(flavor)} 配置`)
        const names = new Map(configuration.targets.map(target => [target.id, target.name]))
        const targets: CmakeTarget[] = []
        for (const target of configuration.targets) {
            const reply = await this.readReplyFile<TargetReply>(directory, target.jsonFile)
            if (reply.name !== target.name) throw new Error(`CMake target 模型身份不匹配：${target.name}`)
            targets.push({ name: reply.name, type: reply.type, artifacts: (reply.artifacts ?? []).map(artifact => resolve(directory, artifact.path)), dependencies: (reply.dependencies ?? []).map(dependency => names.get(dependency.id)).filter((name): name is string => !!name) })
        }
        return { sourceDirectory: resolve(codemodel.paths.source), buildDirectory: directory, configuration: configuration.name, platform: this.platform.name, architecture: state.local!.native!.architecture, targets }
    }

    productTargets(state: ProjectState, products: readonly NativeProduct[]): string[] {
        for (const product of products) if (!state.project.project.products.includes(product)) throw new Error(`工程没有启用 ${product}`)
        return [...new Set(products)].map(product => `${state.project.native.target}_${productTargetSuffixes[product]}`)
    }

    productArtifacts(state: ProjectState, model: CmakeModel, products: readonly NativeProduct[]): ProductArtifacts[] {
        const root = model.targets.find(target => target.name === state.project.native.target)
        if (!root || root.type !== "STATIC_LIBRARY") throw new Error(`未找到 JUCE 插件共享代码目标 ${state.project.native.target}，请核对 YAML 与 CMakeLists`)
        const names = this.productTargets(state, products)
        return [...new Set(products)].map((product, index) => {
            const target = model.targets.find(item => item.name === names[index])
            const expectedType = product === "standalone" ? "EXECUTABLE" : "MODULE_LIBRARY"
            if (!target || target.type !== expectedType || !target.dependencies.includes(root.name)) throw new Error(`产品目标 ${names[index]} 不存在，或不符合 JUCE ${product} 目标契约`)
            if (!target.artifacts.length) throw new Error(`CMake 未报告产品目标 ${target.name} 的产物路径`)
            return { product, target: target.name, paths: target.artifacts }
        })
    }

    async build(state: ProjectState, flavor: BuildFlavor, products: readonly NativeProduct[], clean = false): Promise<CmakeModel> {
        const local = state.local
        if (!local?.cmake) throw new Error("未配置 CMake")
        await this.configure(state, flavor)
        await assertPlainDirectoryPath(state.rootDir, this.buildDirectory(state, flavor))
        const args = ["--build", this.buildDirectory(state, flavor), "--config", this.configuration(flavor)]
        if (process.env.CMAKE_BUILD_PARALLEL_LEVEL === undefined) args.push("--parallel")
        args.push("--target", ...this.productTargets(state, products))
        if (clean) args.push("--clean-first")
        const result = await this.executor.run({ command: local.cmake.path, args, cwd: state.rootDir, env: await this.platform.nativeEnvironment(local), stdio: "inherit" })
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`原生构建未成功（${result.exitCode}）${result.cancelled ? "：已取消" : ""}`)
        return this.readModel(state, flavor)
    }

    private configuration(flavor: BuildFlavor): string { return flavor === "debug" ? "Debug" : "Release" }
    private preparationPath(state: ProjectState, flavor: BuildFlavor): string { return join(this.buildDirectory(state, flavor), cmakePreparationFileName) }
    presentationSignature(state: ProjectState): Promise<string> { return nativePresentationSignature(state, this.platform.name) }
    private iconDirectory(state: ProjectState, flavor: BuildFlavor): string { return join(this.buildDirectory(state, flavor), nativeIconDirectory) }
    private async signature(state: ProjectState, flavor: BuildFlavor): Promise<string> {
        const { vendorName, vendorCode, pluginCode, version, products } = state.project.project
        return hash(JSON.stringify({ native: state.project.native, project: { vendorName, vendorCode, pluginCode, version, products }, presentation: await this.presentationSignature(state), framework: { version: state.project.framework.version, cmakeFetchContentUrl: state.project.framework.cmakeFetchContentUrl }, local: { cmake: state.local?.cmake, nativeCompiler: state.local?.nativeCompiler, ninja: state.local?.ninja, native: state.local?.native }, platform: this.platform.name, flavor }))
    }

    private async readReply<T>(directory: string, kind: string): Promise<T> {
        const replyDirectory = join(directory, ".cmake", "api", "v1", "reply")
        await assertPlainDirectoryPath(directory, replyDirectory)
        const indexes = (await readdir(replyDirectory)).filter(file => /^index-.*\.json$/.test(file)).sort()
        const latest = indexes.at(-1)
        if (!latest) throw new Error("未找到 CMake File API 查询结果，请先运行 arrange sync --setup")
        const index = JSON.parse(await readFile(join(replyDirectory, latest), "utf8")) as ReplyIndex
        const reference = index.reply[`client-${cmakeQueryClientName}`]?.[kind]
        if (!reference?.jsonFile || reference.error) throw new Error(`CMake 查询 ${kind} 失败：${reference?.error ?? "缺少结果"}`)
        return this.readReplyFile<T>(directory, reference.jsonFile)
    }

    private async readReplyFile<T>(directory: string, filename: string): Promise<T> {
        if (basename(filename) !== filename) throw new Error("CMake 查询文件引用包含非法目录")
        return JSON.parse(await readFile(join(directory, ".cmake", "api", "v1", "reply", filename), "utf8")) as T
    }

    private async inputHashes(state: ProjectState, flavor: BuildFlavor): Promise<Record<string, string>> {
        const files = await this.readReply<CmakeFilesReply>(this.buildDirectory(state, flavor), "cmakeFiles-v1")
        const result: Record<string, string> = {}
        for (const file of files.inputs) if (!file.isGenerated && !file.isExternal) {
            const path = resolve(files.paths.source, file.path)
            result[path] = hash(await readFile(path))
        }
        return result
    }

    private async resetIncompatibleTree(state: ProjectState, flavor: BuildFlavor): Promise<void> {
        const directory = this.buildDirectory(state, flavor)
        await assertPlainDirectoryPath(state.rootDir, directory)
        let cache: string
        try { cache = await readFile(join(directory, "CMakeCache.txt"), "utf8") } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return
            throw error
        }
        const value = (key: string): string | undefined => cache.match(new RegExp(`^${key}:[^=]+=([^\\r\\n]*)`, "m"))?.[1]
        const local = state.local!
        const previousCompiler = value("CMAKE_CXX_COMPILER")
        const previousSource = value("CMAKE_HOME_DIRECTORY")
        const incompatible = value("CMAKE_GENERATOR") !== local.native!.generator || !previousSource || resolve(previousSource) !== resolve(state.rootDir, state.project.native.directory) || (previousCompiler && resolve(previousCompiler) !== resolve(local.nativeCompiler!.path))
        if (incompatible) await rm(directory, { recursive: true, force: true })
    }

    private async assertCacheArchitecture(state: ProjectState, flavor: BuildFlavor): Promise<void> {
        const local = state.local!
        const cache = await readFile(join(this.buildDirectory(state, flavor), "CMakeCache.txt"), "utf8")
        const value = (key: string): string | undefined => cache.match(new RegExp(`^${key}:[^=]+=([^\\r\\n]*)`, "m"))?.[1]
        if (value("CMAKE_GENERATOR") !== local.native!.generator) throw new Error("CMake 实际生成器与本机配置不符")
        if (this.platform.name === "darwin") {
            const expected = local.native!.architecture === "x64" ? "x86_64" : "arm64"
            if (value("CMAKE_OSX_ARCHITECTURES") !== expected) throw new Error("CMake 实际 macOS 架构与本机配置不符")
        } else if (local.native!.generator.startsWith("Visual Studio")) {
            if (value("CMAKE_GENERATOR_PLATFORM")?.toLowerCase() !== local.native!.architecture.toLowerCase()) throw new Error("CMake 实际 Visual Studio 架构与本机配置不符")
        }
        const compiler = value("CMAKE_CXX_COMPILER")
        const normalize = (path: string): string => this.platform.name === "win32" ? resolve(path).toLowerCase() : resolve(path)
        if (!compiler || !local.nativeCompiler || normalize(compiler) !== normalize(local.nativeCompiler.path)) throw new Error("CMake 实际编译器与已验证的本机编译器不符")
    }
}
