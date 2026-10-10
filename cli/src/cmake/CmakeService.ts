import { createHash } from "node:crypto"
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { cmakePreparationFileName, cmakeQueryClientName, localWorkDirectory, nativeBuildDirectoryName, nativeIconCmakeDefinitions, nativeIconDirectory, productTargetSuffixes, windowsBuildOwnerFileName, windowsBuildPathTailBudget, windowsBuildRootName, windowsExternalSourceTailBudget, windowsBuildRootSubdirectory, windowsMaxPathLength } from "../CliMetadata.ts"
import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { Executor } from "../platform/Executor.ts"
import type { PlatformService } from "../platform/PlatformService.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { IconAssetsService } from "../asset/IconAssetsService.ts"
import { nativePresentationSignature } from "../project/NativePresentation.ts"
import { isAbortError, throwIfProcessCancelled } from "../platform/ProcessSpec.ts"
import { ninjaProgress, type TaskOutput } from "../ui/Tasks.ts"

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

// 完整路径 = 构建目录 + 分隔符 + 构建树内最长相对路径；超限时 cl、link、rc 打不开文件，错误信息晦涩，所以在 configure 前明确检查
export function windowsBuildPathProblem(directory: string, tailBudget: number = windowsBuildPathTailBudget): string | undefined {
    const limit = windowsMaxPathLength - tailBudget - 1
    if (directory.length <= limit) return undefined
    return `构建目录路径过长（${directory.length} 个字符）：Windows 的 cl、link、rc 不支持超过 ${windowsMaxPathLength} 字符的完整路径，构建树内最长文件约占 ${tailBudget} 字符，构建目录需不超过 ${limit} 个字符。请在 arrange.local.yaml 的 native.buildRoot 指定更短的目录：${directory}`
}

// 本机配置用外部 JUCE 源码时，对象路径会内嵌源码绝对路径，尾部更长
export function windowsTailBudget(definitions: Readonly<Record<string, string>> | undefined): number {
    return definitions && ("JUCE_DIR" in definitions || "FETCHCONTENT_SOURCE_DIR_JUCE" in definitions) ? windowsExternalSourceTailBudget : windowsBuildPathTailBudget
}

export class CmakeService {
    private readonly claims = new Map<string, Promise<void>>()

    constructor(private readonly executor: Executor, private readonly platform: PlatformService, private readonly icons: IconAssetsService) { }

    // Windows：构建树放在 %LOCALAPPDATA%\Arrange\b\<工程根哈希前 8 位>\<架构 x/a><配置 d/r>，与工程路径长度无关；其它平台仍在工程内的 .arrange/build 下
    buildDirectory(state: ProjectState, flavor: BuildFlavor): string {
        const arch = state.local?.native?.architecture
        if (!arch) throw new Error("本机 native 工具环境尚未准备，请先运行 arrange sync --setup")
        if (this.platform.name === "win32") return join(this.windowsBuildBase(state), `${arch === "arm64" ? "a" : "x"}${flavor === "debug" ? "d" : "r"}`)
        return resolve(state.rootDir, localWorkDirectory, nativeBuildDirectoryName, `${this.platform.name === "darwin" ? "mac" : "win"}-${arch}`, flavor)
    }

    private windowsBuildAnchor(state: ProjectState): string {
        const configured = state.local?.native?.buildRoot
        if (configured) return resolve(configured)
        return join(process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local"), windowsBuildRootName, windowsBuildRootSubdirectory)
    }

    private windowsBuildBase(state: ProjectState): string {
        const digest = createHash("sha256").update(resolve(state.rootDir).toLowerCase()).digest("hex").slice(0, 8)
        return join(this.windowsBuildAnchor(state), digest)
    }

    private buildAnchor(state: ProjectState): string {
        return this.platform.name === "win32" ? this.windowsBuildAnchor(state) : state.rootDir
    }

    private async assertBuildDirectory(state: ProjectState, flavor: BuildFlavor): Promise<void> {
        const anchor = this.buildAnchor(state)
        if (anchor !== state.rootDir) {
            try { await access(anchor) } catch { return }
        }
        await assertPlainDirectoryPath(anchor, this.buildDirectory(state, flavor))
    }

    // debug 与 release 并行 configure 时共用同一个哈希目录：同一进程内只认领一次
    private claimWindowsBuildBase(state: ProjectState): Promise<void> {
        const base = this.windowsBuildBase(state)
        let claim = this.claims.get(base)
        if (!claim) {
            claim = this.claimBase(state, base)
            this.claims.set(base, claim)
            claim.catch(() => this.claims.delete(base))
        }
        return claim
    }

    // 哈希目录记录所属工程根；极小概率的哈希碰撞或工程被拷贝到别处时，不静默共用同一棵构建树
    private async claimBase(state: ProjectState, base: string): Promise<void> {
        await mkdir(base, { recursive: true })
        const ownerPath = join(base, windowsBuildOwnerFileName)
        const root = resolve(state.rootDir)
        let owner: { rootDir?: string } | undefined
        try { owner = JSON.parse(await readFile(ownerPath, "utf8")) as { rootDir?: string } } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error
        }
        if (owner?.rootDir && resolve(owner.rootDir).toLowerCase() !== root.toLowerCase()) throw new Error(`构建目录已被另一个工程占用：${base}（${owner.rootDir}）。请在 arrange.local.yaml 的 native.buildRoot 指定其它位置`)
        if (!owner?.rootDir) await writeFile(ownerPath, `${JSON.stringify({ rootDir: root }, null, 4)}\n`)
    }

    async inspect(state: ProjectState, flavor: BuildFlavor): Promise<CmakeInspection> {
        try {
            await this.assertBuildDirectory(state, flavor)
            const preparation = JSON.parse(await readFile(this.preparationPath(state, flavor), "utf8")) as Preparation
            if (preparation.signature !== await this.signature(state, flavor)) return { ready: false, reason: "原生配置或本机工具环境已变化，需要重新 configure" }
            const iconInspection = await this.icons.inspect(state, this.iconDirectory(state, flavor), this.buildAnchor(state))
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

    async configure(state: ProjectState, flavor: BuildFlavor, task: TaskOutput): Promise<CmakeModel> {
        const local = state.local
        if (!local?.cmake || !local.nativeCompiler || !local.native) throw new Error("原生工具配置不完整，请先运行 arrange sync --setup")
        task.stage("准备构建目录与图标")
        const directory = this.buildDirectory(state, flavor)
        if (this.platform.name === "win32") {
            const problem = windowsBuildPathProblem(directory, windowsTailBudget(local.native.cmakeDefinitions))
            if (problem) throw new Error(problem)
            await this.claimWindowsBuildBase(state)
        }
        await this.assertBuildDirectory(state, flavor)
        await this.resetIncompatibleTree(state, flavor)
        await rm(this.preparationPath(state, flavor), { force: true })
        const signature = await this.signature(state, flavor)
        const presentation = await this.presentationSignature(state)
        const icons = await this.icons.prepare(state, this.iconDirectory(state, flavor), this.buildAnchor(state))
        const query = join(directory, ".cmake", "api", "v1", "query", `client-${cmakeQueryClientName}`)
        await assertPlainDirectoryPath(this.buildAnchor(state), query)
        await mkdir(query, { recursive: true })
        for (const kind of ["codemodel-v2", "cmakeFiles-v1"]) await writeFile(join(query, kind), "")
        // 输出经管道捕获时编译器默认不输出颜色；工具链支持时由 CMake 打开彩色诊断
        const args = ["-S", resolve(state.rootDir, state.project.native.directory), "-B", directory, "-G", local.native.generator, "-DCMAKE_COLOR_DIAGNOSTICS=ON"]
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
        task.stage("配置")
        const result = await this.executor.run(task.process({ command: local.cmake.path, args, cwd: state.rootDir, env }))
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`CMake configure 未成功（${result.exitCode}）${result.cancelled ? "：已取消" : result.timedOut ? "：超时" : ""}`)
        const model = await this.readModel(state, flavor)
        this.productArtifacts(state, model, state.project.project.products)
        const inputHashes = await this.inputHashes(state, flavor)
        if (signature !== await this.signature(state, flavor)) throw new Error("原生配置或图标源在 configure 期间发生变化，请重新运行 native SETUP")
        const iconInspection = await this.icons.inspect(state, this.iconDirectory(state, flavor), this.buildAnchor(state))
        if (!iconInspection.ready) throw new Error(iconInspection.reason ?? "图标派生资源尚未准备")
        await writeFile(this.preparationPath(state, flavor), `${JSON.stringify({ signature, inputHashes }, null, 4)}\n`)
        return model
    }

    async readModel(state: ProjectState, flavor: BuildFlavor): Promise<CmakeModel> {
        const directory = this.buildDirectory(state, flavor)
        await this.assertBuildDirectory(state, flavor)
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

    async build(state: ProjectState, flavor: BuildFlavor, products: readonly NativeProduct[], task: TaskOutput, clean = false): Promise<CmakeModel> {
        const local = state.local
        if (!local?.cmake) throw new Error("未配置 CMake")
        await this.configure(state, flavor, task)
        await this.assertBuildDirectory(state, flavor)
        const args = ["--build", this.buildDirectory(state, flavor), "--config", this.configuration(flavor)]
        if (process.env.CMAKE_BUILD_PARALLEL_LEVEL === undefined) args.push("--parallel")
        args.push("--target", ...this.productTargets(state, products))
        if (clean) args.push("--clean-first")
        task.stage("编译")
        const result = await this.executor.run(task.process({ command: local.cmake.path, args, cwd: state.rootDir, env: await this.platform.nativeEnvironment(local) }, ninjaProgress))
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
        await this.assertBuildDirectory(state, flavor)
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
