import { readFile, rm, stat } from "node:fs/promises"
import { delimiter, dirname, join } from "node:path"
import { frameworkPackageName, cliCompatibility, uiPreparationFileName } from "../../CliMetadata.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { uiDirectory, safeUiOutputDirectory, workDirectory } from "../project/ProjectPaths.ts"
import { Executor } from "../platform/Executor.ts"
import { throwIfProcessCancelled, type ProcessSpec } from "../platform/ProcessSpec.ts"
import { readJsonFile, writeJsonFile } from "../../util/JsonFile.ts"
import type { TaskOutput } from "../operation/Work.ts"
import { hashText, isJsonObject } from "../../util/Utils.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { parseDocument, stringify } from "yaml"
import { writeAtomicText } from "../../util/AtomicFile.ts"

export interface UiPreparation {
    readonly ready: boolean
    readonly reason?: string
    readonly fatal?: boolean
}

export class NodeJsService {
    constructor(private readonly executor: Executor) { }

    packageManagerSpec(state: ProjectState, args: string[]): ProcessSpec {
        const local = state.local
        if (!local?.node || !local.packageManager) throw new Error("Node 或包管理器尚未准备，请运行 arrange sync --setup")
        const path = [dirname(local.node.path), dirname(local.packageManager.path), process.env.PATH ?? ""].join(delimiter)
        // 输出经管道捕获、没有终端：pnpm 需要清理 node_modules 时默认要求终端确认，这里明确允许
        const env: Record<string, string> = { PATH: path, npm_config_update_notifier: "false" }
        if (state.project.ui.packageManager === "pnpm") env.npm_config_confirm_modules_purge = "false"
        return { command: local.packageManager.path, args, cwd: uiDirectory(state), env }
    }

    async inspect(state: ProjectState): Promise<UiPreparation> {
        try {
            await assertPlainDirectoryPath(state.rootDir, workDirectory(state))
            const manifest = await readJsonFile(join(uiDirectory(state), "package.json"))
            if (!isJsonObject(manifest) || !isJsonObject(manifest.scripts) || typeof manifest.scripts.dev !== "string" || typeof manifest.scripts.build !== "string") return { ready: false, fatal: true, reason: "UI package.json 需要 dev 和 build 脚本，请先整理 UI 工程" }
            if (!isJsonObject(manifest.dependencies) || manifest.dependencies[frameworkPackageName] !== state.project.framework.version) return { ready: false, fatal: true, reason: "UI Framework 依赖与工程配置不同，请先完成 CONFIG" }
            await safeUiOutputDirectory(state)
            const installed = await readJsonFile(join(uiDirectory(state), "node_modules", frameworkPackageName, "package.json"))
            if (!isJsonObject(installed) || installed.version !== state.project.framework.version || !isJsonObject(installed.arrange) || installed.arrange.cliCompatibility !== cliCompatibility) return { ready: false, reason: "UI Framework 依赖缺失、版本不同或不兼容" }
            const receipt = await readJsonFile(join(workDirectory(state), uiPreparationFileName))
            if (!isJsonObject(receipt) || receipt.inputHash !== await this.installInputHash(state)) return { ready: false, reason: "UI 依赖准备记录缺失或安装输入已改变" }
            for (const section of [manifest.dependencies, manifest.devDependencies]) if (isJsonObject(section)) {
                for (const name of Object.keys(section)) {
                    if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) return { ready: false, fatal: true, reason: `UI 依赖名称非法：${name}` }
                    if (!(await stat(join(uiDirectory(state), "node_modules", name, "package.json")).catch(() => undefined))?.isFile()) return { ready: false, reason: `UI 依赖缺失：${name}` }
                }
            }
            return { ready: true }
        } catch (error) {
            return { ready: false, fatal: true, reason: error instanceof Error ? error.message : String(error) }
        }
    }

    async install(state: ProjectState, task: TaskOutput): Promise<void> {
        const manifest = await readJsonFile(join(uiDirectory(state), "package.json"))
        if (!isJsonObject(manifest) || !isJsonObject(manifest.scripts) || typeof manifest.scripts.dev !== "string" || typeof manifest.scripts.build !== "string") throw new Error("UI package.json 需要 dev 和 build 脚本，请先整理 UI 工程")
        await safeUiOutputDirectory(state)
        await assertPlainDirectoryPath(state.rootDir, workDirectory(state))
        await rm(join(workDirectory(state), uiPreparationFileName), { force: true })
        await this.authorizeInstallScripts(state)
        const result = await this.executor.run(task.process(this.packageManagerSpec(state, ["install"])))
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`UI 依赖安装失败，退出码 ${result.exitCode}`)
        const installed = await readJsonFile(join(uiDirectory(state), "node_modules", frameworkPackageName, "package.json"))
        if (!isJsonObject(installed) || installed.version !== state.project.framework.version || !isJsonObject(installed.arrange) || installed.arrange.cliCompatibility !== cliCompatibility) throw new Error("安装得到的 Framework 版本或兼容契约不符合工程配置")
        await writeJsonFile(join(workDirectory(state), uiPreparationFileName), { inputHash: await this.installInputHash(state), frameworkVersion: installed.version, packageManager: state.project.ui.packageManager })
    }

    async build(state: ProjectState, task: TaskOutput, clean = false): Promise<string> {
        const prepared = await this.inspect(state)
        if (!prepared.ready) throw new Error(`${prepared.reason}；请运行 arrange sync --setup --ui`)
        const output = await safeUiOutputDirectory(state)
        if (clean) await rm(output, { recursive: true, force: true })
        const result = await this.executor.run(task.process(this.packageManagerSpec(state, ["run", "build"])))
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`UI 构建失败，退出码 ${result.exitCode}`)
        if (!(await stat(join(output, "app.js"))).isFile()) throw new Error(`UI 构建未生成 ${join(output, "app.js")}，请核对 outputDirectory 和 Vite 配置`)
        return output
    }

    private async installInputHash(state: ProjectState): Promise<string> {
        const names = ["package.json", ".npmrc", ...(state.project.ui.packageManager === "pnpm" ? ["pnpm-lock.yaml", "pnpm-workspace.yaml"] : ["package-lock.json"])]
        const contents: string[] = []
        for (const name of names) {
            try { contents.push(name, await readFile(join(uiDirectory(state), name), "utf8")) } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
                contents.push(name, "")
            }
        }
        return hashText(JSON.stringify(contents))
    }

    private async authorizeInstallScripts(state: ProjectState): Promise<void> {
        const uiRoot = uiDirectory(state)
        if (state.project.ui.packageManager === "npm") {
            const path = join(uiRoot, "package.json")
            const manifest = await readJsonFile(path)
            if (!isJsonObject(manifest)) throw new Error("UI package.json 必须是 JSON 对象，无法配置安装脚本授权")
            if (manifest.allowScripts !== undefined && !isJsonObject(manifest.allowScripts)) throw new Error("UI package.json 的 allowScripts 必须是对象，请修复后重试")
            const allowed = { ...(manifest.allowScripts as Record<string, unknown> | undefined), esbuild: true }
            if ((manifest.allowScripts as Record<string, unknown> | undefined)?.esbuild !== true) {
                manifest.allowScripts = allowed
                await writeAtomicText(path, `${JSON.stringify(manifest, null, 2)}\n`)
            }
            return
        }

        const path = join(uiRoot, "pnpm-workspace.yaml")
        let source = ""
        try { source = await readFile(path, "utf8") } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        const document = parseDocument(source)
        if (document.errors.length) throw new Error(`pnpm-workspace.yaml 无法解析，无法配置安装脚本授权：${document.errors.map(error => error.message).join("；")}`)
        const root = document.toJS() as unknown
        if (root !== null && root !== undefined && !isJsonObject(root)) throw new Error("pnpm-workspace.yaml 顶层必须是映射，无法配置安装脚本授权")
        let builds: Record<string, unknown> = {}
        if (isJsonObject(root) && root.allowBuilds !== undefined) {
            if (isJsonObject(root.allowBuilds)) builds = { ...root.allowBuilds }
            else if (root.allowBuilds === "esbuild: set this to true or false") builds = {}
            else throw new Error("pnpm-workspace.yaml 的 allowBuilds 必须是映射，无法安全配置安装脚本授权")
        }
        if (builds.esbuild === true && source.length > 0) return
        document.setIn(["allowBuilds"], { ...builds, esbuild: true })
        await writeAtomicText(path, stringify(document))
    }
}
