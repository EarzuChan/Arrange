import { defaultFetchUrl, frameworkSourceProbeTimeoutMs } from "../CliMetadata.ts"
import type { Executor } from "../platform/Executor.ts"
import { throwIfProcessCancelled } from "../platform/ProcessSpec.ts"
import { locateTool } from "../platform/ToolLocator.ts"
import { isManagedItem, type ProjectState } from "../project/ProjectState.ts"

export type FrameworkSourceCheck =
    | { readonly kind: "skipped" }
    | { readonly kind: "ok" }
    | { readonly kind: "git-missing" }
    | { readonly kind: "tag-missing", readonly url: string, readonly tag: string, readonly version: string }
    | { readonly kind: "unreachable", readonly url: string, readonly reason: string }

const sourceOverrideDefinition = "FETCHCONTENT_SOURCE_DIR_ARRANGE"

// 仓库地址里可能带凭据（https://user:token@host/…），出现在报错里前先抹掉
function redactUrl(url: string): string {
    return url.replace(/(\/\/)[^/@\s]+@/, "$1***@")
}

// native 的 CMake 用 FetchContent 按 `v<Framework 版本>` 去 Arrange 仓库取原生源码。
// 在花时间装 UI 依赖和配置构建树之前先确认：git 可用、仓库可达、对应 tag 存在。
export class FrameworkSourceProbe {
    constructor(private readonly executor: Executor, private readonly locate: typeof locateTool = locateTool, private readonly sources?: { hasFramework(state: ProjectState): Promise<boolean> }) { }

    // 只有仓库地址与 tag 都由 CLI 托管时才知道 CMake 会取什么；已用本地源码覆盖时不需要联网
    applies(state: ProjectState): boolean {
        if (!isManagedItem(state, "cmake.fetch-content-repository") || !isManagedItem(state, "framework.version")) return false
        return state.local?.native?.cmakeDefinitions?.[sourceOverrideDefinition] === undefined
    }

    async check(state: ProjectState): Promise<FrameworkSourceCheck> {
        if (!this.applies(state)) return { kind: "skipped" }
        if (await this.sources?.hasFramework(state)) return { kind: "ok" }
        const url = state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl
        const version = state.project.framework.version
        const tag = `v${version}`
        const git = await this.locate("git")
        if (!git) return { kind: "git-missing" }
        // GIT_TERMINAL_PROMPT=0：地址需要凭据时直接失败，不在 SETUP 中途停下等输入
        const result = await this.executor.run({ command: git, args: ["ls-remote", "--tags", url, `refs/tags/${tag}`], env: { GIT_TERMINAL_PROMPT: "0" }, timeoutMs: frameworkSourceProbeTimeoutMs })
        throwIfProcessCancelled(result)
        if (result.timedOut) return { kind: "unreachable", url: redactUrl(url), reason: `超过 ${frameworkSourceProbeTimeoutMs / 1000} 秒没有响应` }
        if (result.exitCode !== 0) return { kind: "unreachable", url: redactUrl(url), reason: redactUrl((result.stderr || result.stdout).trim().split(/\r?\n/).slice(0, 2).join("；") || `git 退出码 ${result.exitCode}`) }
        return result.stdout.trim() ? { kind: "ok" } : { kind: "tag-missing", url: redactUrl(url), tag, version }
    }
}

// 预检不通过时的说明；通过或不适用返回 undefined
export function frameworkSourceProblem(check: FrameworkSourceCheck): string | undefined {
    const remedy = `也可以在 arrange.local.yaml 的 native.cmakeDefinitions 里设置 ${sourceOverrideDefinition} 指向本地 Arrange 源码`
    if (check.kind === "git-missing") return "未找到 git。native 构建要用 CMake FetchContent 克隆 Arrange 源码，请先安装 git 并确认它在 PATH 中"
    if (check.kind === "tag-missing") return `Arrange 源码仓库 ${check.url} 上没有 tag ${check.tag}，CMake FetchContent 取不到与 Framework ${check.version} 对应的原生源码。请确认该版本的 tag 已发布；${remedy}`
    if (check.kind === "unreachable") return `无法访问 Arrange 源码仓库 ${check.url}（git ls-remote 失败：${check.reason}）。请检查网络、代理或仓库地址；${remedy}`
    return undefined
}
