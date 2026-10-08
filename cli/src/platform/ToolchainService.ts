import { minimumCmakeVersion, minimumNodeMajor, toolProbeTimeoutMs } from "../CliMetadata.ts"
import { basename, delimiter, dirname } from "node:path"
import type { LocalDefinition, ProjectState } from "../project/ProjectState.ts"
import type { Executor } from "./Executor.ts"
import type { PlatformService, ToolchainIssue } from "./PlatformService.ts"
import { environmentValue, locateTool } from "./ToolLocator.ts"
import { isAbortError, throwIfProcessCancelled } from "./ProcessSpec.ts"

export interface ToolchainInspection {
    readonly local: LocalDefinition
    readonly issues: readonly ToolchainIssue[]
}

export function satisfiesMinimumVersion(version: string, minimum: string): boolean {
    const actual = version.match(/\d+\.\d+(?:\.\d+)?/)?.[0].split(".").map(Number)
    const expected = minimum.split(".").map(Number)
    if (!actual) return false
    for (let index = 0; index < expected.length; index++) {
        const difference = (actual[index] ?? 0) - (expected[index] ?? 0)
        if (difference !== 0) return difference > 0
    }
    return true
}

export class ToolchainService {
    constructor(private readonly executor: Executor, private readonly platform: PlatformService) { }

    async inspect(state: ProjectState, scope: "Global" | "UI" | "Native"): Promise<ToolchainInspection> {
        let candidate: LocalDefinition = structuredClone(state.local ?? {})
        const issues: ToolchainIssue[] = []
        if (scope !== "Native") {
            candidate.node ??= { path: process.execPath }
            await this.probe(candidate, "node", [], issues, `Node.js ${minimumNodeMajor}+`, text => satisfiesMinimumVersion(text, `${minimumNodeMajor}.0.0`))
            const packageManager = candidate.packageManager?.path ?? await locateTool(state.project.ui.packageManager)
            if (!packageManager) issues.push({ key: "packageManager", label: state.project.ui.packageManager, message: `未找到 ${state.project.ui.packageManager}，请安装或配置其可执行路径` })
            else {
                candidate.packageManager ??= { path: packageManager }
                const identity = basename(packageManager).toLowerCase().replace(/\.(?:cmd|bat|exe|mjs|cjs|js)$/, "").replace(/-cli$/, "")
                if ((identity === "npm" || identity === "pnpm") && identity !== state.project.ui.packageManager) issues.push({ key: "packageManager", label: state.project.ui.packageManager, message: `本机包管理器路径指向 ${identity}，工程选择的是 ${state.project.ui.packageManager}，请更新 arrange.local.yaml` })
                const nodeEnv = { PATH: `${dirname(candidate.node.path)}${delimiter}${environmentValue(process.env, "PATH") ?? ""}` }
                await this.probe(candidate, "packageManager", [], issues, state.project.ui.packageManager, undefined, nodeEnv)
            }
        }
        if (scope !== "UI") {
            const native = await this.platform.discoverNative(candidate)
            candidate = native.local
            issues.push(...native.issues)
            let env: Record<string, string> = {}
            try { env = await this.platform.nativeEnvironment(candidate) } catch (error) {
                if (isAbortError(error)) throw error
                if (!issues.some(issue => issue.key === "nativeCompiler")) issues.push({ key: "nativeCompiler", label: "原生工具环境", message: String(error) })
            }
            if (candidate.cmake) await this.probe(candidate, "cmake", [], issues, `CMake ${minimumCmakeVersion}+`, text => satisfiesMinimumVersion(text, minimumCmakeVersion), env)
            if (candidate.ninja && candidate.native?.generator.startsWith("Ninja")) await this.probe(candidate, "ninja", [], issues, "Ninja", undefined, env)
        }
        return { local: candidate, issues }
    }

    private async probe(local: LocalDefinition, key: "node" | "packageManager" | "cmake" | "ninja", args: readonly string[], issues: ToolchainIssue[], label: string, validate?: (version: string) => boolean, env?: Record<string, string>): Promise<void> {
        const tool = local[key]
        if (!tool) return
        try {
            const result = await this.executor.run({ command: tool.path, args: [...args, "--version"], env, timeoutMs: toolProbeTimeoutMs })
            throwIfProcessCancelled(result)
            const version = (result.stdout || result.stderr).trim()
            if (result.exitCode !== 0 || !version || (validate && !validate(version))) issues.push({ key, label, message: `${label} 不可用或版本不符合要求：${tool.path}${version ? ` (${version.split("\n")[0]})` : ""}` })
            else tool.version = version.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? version.split("\n")[0]
        } catch (error) {
            if (isAbortError(error)) throw error
            issues.push({ key, label, message: `无法执行 ${tool.path}：${String(error)}` })
        }
    }
}
