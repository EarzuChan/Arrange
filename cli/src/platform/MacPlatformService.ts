import { toolProbeTimeoutMs, defaultNativeGenerator } from "../CliMetadata.ts"
import type { LocalDefinition } from "../project/ProjectState.ts"
import { PlatformService, type NativeToolchainDiscovery, type ToolchainIssue } from "./PlatformService.ts"
import { locateTool } from "./ToolLocator.ts"
import { isAbortError, throwIfProcessCancelled } from "./ProcessSpec.ts"

export class MacPlatformService extends PlatformService {
    readonly name = "darwin" as const

    async nativeEnvironment(local: LocalDefinition): Promise<Record<string, string>> {
        return local.native?.developerDirectory ? { DEVELOPER_DIR: local.native.developerDirectory } : {}
    }

    async discoverNative(local: LocalDefinition): Promise<NativeToolchainDiscovery> {
        const candidate: LocalDefinition = structuredClone(local)
        const issues: ToolchainIssue[] = []
        candidate.native ??= { generator: defaultNativeGenerator, architecture: process.arch === "arm64" ? "arm64" : "x64" }
        try {
            const selected = await this.executor.run({ command: "/usr/bin/xcode-select", args: ["-p"], timeoutMs: toolProbeTimeoutMs })
            throwIfProcessCancelled(selected)
            if (!candidate.native.developerDirectory && selected.exitCode === 0) candidate.native.developerDirectory = selected.stdout.trim()
            const env = await this.nativeEnvironment(candidate)
            const compiler = await this.executor.run({ command: "/usr/bin/xcrun", args: ["--find", "clang++"], env, timeoutMs: toolProbeTimeoutMs })
            throwIfProcessCancelled(compiler)
            if (compiler.exitCode !== 0) issues.push({ key: "nativeCompiler", label: "Xcode clang", message: "无法通过 xcrun 找到 clang++，请安装或选择 Xcode/Command Line Tools" })
            else {
                const path = candidate.nativeCompiler?.path ?? compiler.stdout.trim()
                const version = await this.executor.run({ command: path, args: ["--version"], env, timeoutMs: toolProbeTimeoutMs })
                throwIfProcessCancelled(version)
                if (version.exitCode !== 0 || !/Apple clang/i.test(version.stdout)) issues.push({ key: "nativeCompiler", label: "Xcode clang", message: `无法验证 Xcode clang++：${path}` })
                else candidate.nativeCompiler = { path, version: version.stdout.split("\n")[0]?.trim() }
            }
            if (candidate.native.generator === "Xcode") {
                const xcode = await this.executor.run({ command: "/usr/bin/xcodebuild", args: ["-version"], env, timeoutMs: toolProbeTimeoutMs })
                throwIfProcessCancelled(xcode)
                if (xcode.exitCode !== 0 || !/^Xcode\s+\d/m.test(xcode.stdout)) issues.push({ key: "native", label: "Xcode generator", message: "Xcode 生成器需要完整 Xcode，当前 Developer Directory 不可用，请设置 native.developerDirectory 或选择 Ninja" })
            }
        } catch (error) {
            if (isAbortError(error)) throw error
            issues.push({ key: "nativeCompiler", label: "Xcode clang", message: String(error) })
        }
        const env = { ...process.env, ...await this.nativeEnvironment(candidate) }
        for (const [key, command] of [["cmake", "cmake"], ["ninja", "ninja"]] as const) {
            if (key === "ninja" && !candidate.native.generator.startsWith("Ninja")) continue
            const path = candidate[key]?.path ?? await locateTool(command, env)
            if (!path) issues.push({ key, label: command, message: `未找到 ${command}，请安装工具或填写本机路径` })
            else candidate[key] = { path }
        }
        return { local: candidate, issues }
    }
}
