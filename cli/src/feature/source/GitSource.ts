import { Executor } from "../platform/Executor.ts"
import { locateTool } from "../platform/ToolLocator.ts"
import { throwIfProcessCancelled, type ProcessSpec } from "../platform/ProcessSpec.ts"
import type { TaskOutput } from "../operation/Work.ts"
import { sourceLocalTimeoutMs } from "../../CliMetadata.ts"
import { redactSourceUrl, type SourceSpec } from "./SourceSpec.ts"
import { LineDecoder } from "../../util/LineDecoder.ts"
import { InspectionError } from "../../util/RecordInspection.ts"

export class GitSource {
    constructor(private readonly executor: Executor) { }

    async verify(directory: string, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted()
        const git = await locateTool("git")
        if (!git) throw new Error("共享依赖源码缓存校验需要 git，请安装 git 并确认它在 PATH 中")
        const result = await this.executor.run({ command: git, args: ["-c", "core.longpaths=true", "-c", "core.autocrlf=false", "diff", "--quiet", "HEAD", "--"], cwd: directory, signal, env: { GIT_TERMINAL_PROMPT: "0" }, timeoutMs: sourceLocalTimeoutMs })
        signal.throwIfAborted()
        throwIfProcessCancelled(result)
        if (result.exitCode !== 0) throw new InspectionError({ state: result.exitCode === 1 ? "damaged" : "unavailable", path: directory, reason: result.exitCode === 1 ? "受跟踪的依赖源码已被修改，本地修改应使用显式目录覆盖" : `Git 无法验证依赖源码：${result.stderr.trim() || `退出码 ${result.exitCode}`}` })
    }

    async checkout(spec: SourceSpec, directory: string, task: TaskOutput, signal: AbortSignal): Promise<string> {
        const git = await locateTool("git")
        if (!git) throw new Error("共享依赖源码缓存需要 git，请安装 git 并确认它在 PATH 中")

        const run = async (args: readonly string[], network = false): Promise<string> => {
            signal.throwIfAborted()
            const process: ProcessSpec = { command: git, args: ["-c", "core.longpaths=true", "-c", "core.autocrlf=false", ...args], cwd: directory, env: { GIT_TERMINAL_PROMPT: "0" }, signal, ...(network ? {} : { timeoutMs: sourceLocalTimeoutMs }) }
            // Git 的诊断可能回显含凭据的远端地址，先脱敏再交给任务输出
            const sink = (line: string): void => task.line(redactSourceUrl(line))
            const decoders = { stdout: new LineDecoder(sink), stderr: new LineDecoder(sink) }
            const result = await this.executor.run(network ? {
                ...process, onOutput: (chunk, channel) => decoders[channel].push(chunk), onOutputEnd: () => {
                    decoders.stdout.flush()
                    decoders.stderr.flush()
                }
            } : process)
            signal.throwIfAborted()
            throwIfProcessCancelled(result)
            if (result.exitCode !== 0) throw new Error(`获取 ${redactSourceUrl(spec.repository)} · ${spec.ref} 失败：${redactSourceUrl(result.stderr || result.stdout).trim() || `git 退出码 ${result.exitCode}`}`)
            return result.stdout.trim()
        }

        await run(["init", "--quiet"])

        // 子模块的相对 URL 需要以 origin 为基准，不能直接用一次性 URL fetch 代替仓库来源
        await run(["remote", "add", "--", "origin", spec.repository])

        await run(["fetch", "--depth", "1", "--no-tags", "--", "origin", spec.ref], true)

        await run(["checkout", "--quiet", "--detach", "FETCH_HEAD"])

        const commit = await run(["rev-parse", "HEAD"])

        if (spec.commit && commit.toLowerCase() !== spec.commit.toLowerCase()) throw new Error(`源码 commit 与依赖清单不符：${spec.ref}（期望 ${spec.commit}，实际 ${commit}）`)

        await run(["submodule", "update", "--init", "--recursive", "--depth", "1"], true)

        await run(["remote", "remove", "origin"])

        return commit
    }
}
