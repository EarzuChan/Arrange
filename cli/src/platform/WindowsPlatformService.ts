import { join } from "node:path"
import { access } from "node:fs/promises"
import { defaultNativeGenerator, toolProbeTimeoutMs } from "../CliMetadata.ts"
import type { LocalDefinition } from "../project/ProjectState.ts"
import { quoteWindowsArgument } from "./Executor.ts"
import { PlatformService, type NativeToolchainDiscovery, type ToolchainIssue } from "./PlatformService.ts"
import { environmentValue, locateTool } from "./ToolLocator.ts"
import { isAbortError, throwIfProcessCancelled } from "./ProcessSpec.ts"

export function parseWindowsEnvironment(output: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const line of output.split(/\r?\n/)) {
        const separator = line.indexOf("=")
        if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1)
    }
    return result
}

export function parseMsvcArchitecture(output: string): "x64" | "arm64" | undefined {
    const architecture = output.match(/\bfor\s+(x64|ARM64)\b/i)?.[1]?.toLowerCase()
    return architecture === "x64" || architecture === "arm64" ? architecture : undefined
}

export class WindowsPlatformService extends PlatformService {
    readonly name = "win32" as const

    async nativeEnvironment(local: LocalDefinition): Promise<Record<string, string>> {
        const native = local.native
        if (!native?.developerCommand) throw new Error("未配置 Visual Studio Developer Command Prompt")
        const arch = native.architecture === "arm64" ? "arm64" : "amd64"
        const command = `call ${quoteWindowsArgument(native.developerCommand)} -no_logo -arch=${arch} -host_arch=amd64 >nul && set`
        const result = await this.executor.run({ command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/v:off", "/s", "/c", command], env: { VSLANG: "1033" }, timeoutMs: toolProbeTimeoutMs, windowsVerbatimArguments: true })
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new Error(`Visual Studio 工具环境初始化失败：${result.stderr || result.stdout}`)
        const env = parseWindowsEnvironment(result.stdout)
        if (!environmentValue(env, "VCToolsInstallDir")) throw new Error("Developer Command Prompt 未提供 MSVC 工具环境")
        const actualArchitecture = environmentValue(env, "VSCMD_ARG_TGT_ARCH")?.toLowerCase()
        if (!(arch === "amd64" ? ["amd64", "x64"] : ["arm64"]).includes(actualArchitecture ?? "")) throw new Error("Developer Command Prompt 目标架构与本机配置不符")
        return env
    }

    async discoverNative(local: LocalDefinition): Promise<NativeToolchainDiscovery> {
        const candidate: LocalDefinition = structuredClone(local)
        const issues: ToolchainIssue[] = []
        candidate.native ??= { generator: defaultNativeGenerator, architecture: process.arch === "arm64" ? "arm64" : "x64" }
        if (!candidate.native.developerCommand) {
            try {
                const installer = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe")
                const found = await this.executor.run({ command: installer, args: ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], timeoutMs: toolProbeTimeoutMs })
                throwIfProcessCancelled(found)
                if (found.exitCode === 0 && found.stdout.trim()) candidate.native.developerCommand = join(found.stdout.trim(), "Common7", "Tools", "VsDevCmd.bat")
            } catch (error) { if (isAbortError(error)) throw error }
        }
        try {
            if (!candidate.native.developerCommand) throw new Error("未发现 Visual Studio C++ 工具安装，请安装 MSVC 并填写 VsDevCmd.bat 路径")
            await access(candidate.native.developerCommand)
            const env = await this.nativeEnvironment(candidate)
            const compilerPath = candidate.nativeCompiler?.path ?? await locateTool("cl.exe", env, "win32")
            if (!compilerPath) throw new Error("Visual Studio 环境中未找到 cl.exe")
            const compiler = await this.executor.run({ command: compilerPath, args: [], env, timeoutMs: toolProbeTimeoutMs })
            throwIfProcessCancelled(compiler)
            const output = `${compiler.stdout}\n${compiler.stderr}`
            const version = output.match(/Version\s+([\d.]+)/i)?.[1]
            if (compiler.exitCode !== 0 || !version) throw new Error(`无法验证 MSVC：${compilerPath}`)
            if (parseMsvcArchitecture(output) !== candidate.native.architecture) throw new Error(`MSVC 实际目标架构与 ${candidate.native.architecture} 配置不符：${compilerPath}`)
            candidate.nativeCompiler = { path: compilerPath, version }
            for (const [key, command] of [["cmake", "cmake.exe"], ["ninja", "ninja.exe"]] as const) {
                if (key === "ninja" && !candidate.native.generator.startsWith("Ninja")) continue
                const path = candidate[key]?.path ?? await locateTool(command, env, "win32")
                if (!path) issues.push({ key, label: command, message: `Visual Studio 环境中未找到 ${command}` })
                else candidate[key] = { path }
            }
        } catch (error) {
            if (isAbortError(error)) throw error
            issues.push({ key: "nativeCompiler", label: "MSVC", message: error instanceof Error ? error.message : String(error) })
        }
        return { local: candidate, issues }
    }
}
