import { frameworkRepositoryUrl } from "../framework/FrameworkOrigin.ts"
import { isManagedItem, type ProjectState } from "../project/ProjectState.ts"
import type { TaskOutput } from "../operation/Work.ts"
import { SourceCache } from "./SourceCache.ts"
import { readNativeDependencies } from "./NativeDependencies.ts"
import type { SourceSpec } from "./SourceSpec.ts"
import { resolve } from "node:path"
import { assertFrameworkDevReadiness, assertFrameworkSource } from '../framework/FrameworkSourceMetadata.ts'

export class NativeSourceService {
    constructor(private readonly cache: SourceCache) { }

    frameworkSpec(state: ProjectState): SourceSpec | undefined {
        if (!isManagedItem(state, "cmake.fetch-content-repository") || !isManagedItem(state, "framework.version")) return undefined
        if (state.local?.native?.cmakeDefinitions?.FETCHCONTENT_SOURCE_DIR_ARRANGE !== undefined) return undefined
        return { repository: frameworkRepositoryUrl(state), ref: `v${state.project.framework.version}` }
    }

    async hasFramework(state: ProjectState): Promise<boolean> {
        const spec = this.frameworkSpec(state)
        return spec !== undefined && await this.cache.find(spec) !== undefined
    }

    async assertDevReadiness(state: ProjectState, task: TaskOutput): Promise<void> {
        const definitions = state.local?.native?.cmakeDefinitions ?? {}
        const framework = this.frameworkSpec(state)
        if (framework) {
            const source = await this.cache.ensure(framework, "Arrange", task, async item => { await assertFrameworkSource(item.directory, state.project.framework.version) })
            await assertFrameworkDevReadiness(source.directory, state.project.framework.version)
            return
        }
        const override = definitions.FETCHCONTENT_SOURCE_DIR_ARRANGE
        if (!override) throw new Error("无法核验 Native 开发就绪协议：请托管 Framework 仓库与版本，或设置 FETCHCONTENT_SOURCE_DIR_ARRANGE")
        await assertFrameworkDevReadiness(resolve(state.rootDir, override), state.project.framework.version)
    }

    async prepare(state: ProjectState, task: TaskOutput): Promise<Readonly<Record<string, string>>> {
        const definitions = state.local?.native?.cmakeDefinitions ?? {}
        const framework = this.frameworkSpec(state)
        const root = framework ? (await this.cache.ensure(framework, "Arrange", task, async source => { await assertFrameworkSource(source.directory, state.project.framework.version) })).directory : definitions.FETCHCONTENT_SOURCE_DIR_ARRANGE
        if (!root) return {}
        if (!framework) await assertFrameworkSource(resolve(state.rootDir, root), state.project.framework.version)
        const dependencies = await readNativeDependencies(resolve(state.rootDir, root))
        const result: Record<string, string> = framework ? { FETCHCONTENT_SOURCE_DIR_ARRANGE: root } : {}
        for (const [name, label, overrides] of [["juce", "JUCE", ["JUCE_DIR", "FETCHCONTENT_SOURCE_DIR_JUCE"]], ["quickjs_ng", "QuickJS-NG", ["ARRANGE_QUICKJS_NG_SOURCE_DIR", "FETCHCONTENT_SOURCE_DIR_QUICKJS_NG"]]] as const) {
            if (overrides.some(key => definitions[key] !== undefined)) continue
            const prefix = name === "juce" ? "ARRANGE_JUCE" : "ARRANGE_QUICKJS_NG"
            const declared = dependencies[name]
            const repository = definitions[`${prefix}_GIT_REPOSITORY`] ?? declared.repository
            const ref = definitions[`${prefix}_GIT_TAG`] ?? declared.ref
            const spec = repository === declared.repository && ref === declared.ref ? declared : { repository, ref }
            result[`FETCHCONTENT_SOURCE_DIR_${name.toUpperCase()}`] = (await this.cache.ensure(spec, label, task)).directory
        }
        return result
    }
}
