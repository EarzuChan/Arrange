import { join } from "node:path"
import { frameworkPackageName } from "../CliMetadata.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { uiDirectory } from "../project/ProjectPaths.ts"
import { readSnapshot } from "../util/FileUtils.ts"
import { isJsonObject } from "../util/Utils.ts"
import { FrameworkRegistryClient } from "./FrameworkRegistryClient.ts"
import { assertFrameworkCompatible } from "./FrameworkMamba.ts"

export type FrameworkCompatibilityMode = "remote" | "installed-first"

export class FrameworkService {
    constructor(private readonly registry: FrameworkRegistryClient) { }

    async assertCompatible(state: ProjectState, mode: FrameworkCompatibilityMode): Promise<void> {
        if (mode === "installed-first" && await this.assertInstalledCompatible(state)) return
        const candidate = await this.registry.fetchCandidateByVersion(state.project.framework.version, state.project.framework.nodeRegistryUrl ?? undefined)
        if (candidate.version !== state.project.framework.version) throw new Error("registry 返回的 Framework 版本与配置不符")
        assertFrameworkCompatible(candidate)
    }

    private async assertInstalledCompatible(state: ProjectState): Promise<boolean> {
        const path = join(uiDirectory(state), "node_modules", frameworkPackageName, "package.json")
        const snapshot = await readSnapshot(path)
        if (snapshot.content === null) return false
        let manifest: unknown
        try { manifest = JSON.parse(snapshot.content) } catch (error) { throw new Error(`已安装的 Framework package.json 无法解析：${path}`, { cause: error }) }
        if (!isJsonObject(manifest) || typeof manifest.version !== "string" || !manifest.version) throw new Error(`已安装的 Framework package.json 缺少有效 version：${path}`)
        if (manifest.version !== state.project.framework.version) return false
        const compatibility = isJsonObject(manifest.arrange) ? manifest.arrange.cliCompatibility : null
        if (typeof compatibility !== "number" || !Number.isInteger(compatibility)) throw new Error(`已安装的 Framework ${manifest.version} 未声明有效的 arrange.cliCompatibility：${path}`)
        assertFrameworkCompatible({ version: manifest.version, cliCompatibility: compatibility, markedLatest: false, publishedAt: null })
        return true
    }
}
