import { defaultFetchUrl } from "../CliMetadata.ts"
import { isManagedItem, type ProjectState } from "../project/ProjectState.ts"
import type { TaskOutput } from "../ui/Tasks.ts"
import { SourceCache } from "./SourceCache.ts"
import { readNativeDependencies } from "./NativeDependencies.ts"
import type { SourceSpec } from "./SourceSpec.ts"
import { resolve } from "node:path"

export class NativeSourceService {
    constructor(private readonly cache: SourceCache) { }

    frameworkSpec(state: ProjectState): SourceSpec | undefined {
        if (!isManagedItem(state, "cmake.fetch-content-repository") || !isManagedItem(state, "framework.version")) return undefined
        if (state.local?.native?.cmakeDefinitions?.FETCHCONTENT_SOURCE_DIR_ARRANGE !== undefined) return undefined
        return { repository: state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl, ref: `v${state.project.framework.version}` }
    }

    async hasFramework(state: ProjectState): Promise<boolean> {
        const spec = this.frameworkSpec(state)
        return spec !== undefined && await this.cache.find(spec) !== undefined
    }

    async prepare(state: ProjectState, task: TaskOutput): Promise<Readonly<Record<string, string>>> {
        const definitions = state.local?.native?.cmakeDefinitions ?? {}
        const framework = this.frameworkSpec(state)
        const root = framework ? (await this.cache.ensure(framework, "Arrange", task)).directory : definitions.FETCHCONTENT_SOURCE_DIR_ARRANGE
        if (!root) return {}
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
