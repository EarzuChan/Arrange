import { readFile, rm, stat } from "node:fs/promises"
import { delimiter, dirname, join } from "node:path"
import { frameworkPackageName, cliCompatibility, uiPreparationFileName } from "../CliMetadata.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { uiDirectory, safeUiOutputDirectory, workDirectory } from "../project/ProjectPaths.ts"
import { Executor } from "../platform/Executor.ts"
import { throwIfProcessCancelled, type ProcessSpec } from "../platform/ProcessSpec.ts"
import { readJsonFile, writeJsonFile } from "../util/JsonFile.ts"
import { hashText, isJsonObject } from "../util/Utils.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"

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
        return { command: local.packageManager.path, args, cwd: uiDirectory(state), env: { PATH: path, npm_config_update_notifier: "false" } }
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

    async install(state: ProjectState): Promise<void> {
        const manifest = await readJsonFile(join(uiDirectory(state), "package.json"))
        if (!isJsonObject(manifest) || !isJsonObject(manifest.scripts) || typeof manifest.scripts.dev !== "string" || typeof manifest.scripts.build !== "string") throw new Error("UI package.json 需要 dev 和 build 脚本，请先整理 UI 工程")
        await safeUiOutputDirectory(state)
        await assertPlainDirectoryPath(state.rootDir, workDirectory(state))
        await rm(join(workDirectory(state), uiPreparationFileName), { force: true })
        const result = await this.executor.run({ ...this.packageManagerSpec(state, ["install"]), stdio: "inherit" })
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`UI 依赖安装失败，退出码 ${result.exitCode}`)
        const installed = await readJsonFile(join(uiDirectory(state), "node_modules", frameworkPackageName, "package.json"))
        if (!isJsonObject(installed) || installed.version !== state.project.framework.version || !isJsonObject(installed.arrange) || installed.arrange.cliCompatibility !== cliCompatibility) throw new Error("安装得到的 Framework 版本或兼容契约不符合工程配置")
        await writeJsonFile(join(workDirectory(state), uiPreparationFileName), { inputHash: await this.installInputHash(state), frameworkVersion: installed.version, packageManager: state.project.ui.packageManager })
    }

    async build(state: ProjectState, clean = false): Promise<string> {
        const prepared = await this.inspect(state)
        if (!prepared.ready) throw new Error(`${prepared.reason}；请运行 arrange sync --setup --ui`)
        const output = await safeUiOutputDirectory(state)
        if (clean) await rm(output, { recursive: true, force: true })
        const result = await this.executor.run({ ...this.packageManagerSpec(state, ["run", "build"]), stdio: "inherit" })
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`UI 构建失败，退出码 ${result.exitCode}`)
        if (!(await stat(join(output, "app.js"))).isFile()) throw new Error(`UI 构建未生成 ${join(output, "app.js")}，请核对 outputDirectory 和 Vite 配置`)
        return output
    }

    private async installInputHash(state: ProjectState): Promise<string> {
        const names = ["package.json", ".npmrc", state.project.ui.packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json"]
        const contents: string[] = []
        for (const name of names) {
            try { contents.push(name, await readFile(join(uiDirectory(state), name), "utf8")) } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
                contents.push(name, "")
            }
        }
        return hashText(JSON.stringify(contents))
    }
}
