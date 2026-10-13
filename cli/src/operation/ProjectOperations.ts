import { dirname, resolve } from "node:path"
import type { BuildFlavor, ProjectState } from "../project/ProjectState.ts"
import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import type { CmakeService } from "../cmake/CmakeService.ts"
import { uiDirectory } from "../project/ProjectPaths.ts"
import { Operations } from "./Operations.ts"
import { ResourcePlanChanged } from "../util/ResourcePlanChanged.ts"
import type { Resource } from "./Resource.ts"
import { defaultDevServerUrl, defaultNativeGenerator } from "../CliMetadata.ts"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"

export interface ProjectAccess {
    readonly configuration: "read" | "write"
    readonly ui?: "read" | "write"
    readonly native?: "read" | "write"
    readonly flavors?: readonly BuildFlavor[]
    readonly artifacts?: "read" | "write"
    readonly nativeSource?: "read" | "write"
    readonly liveServer?: boolean
    readonly observe?: boolean
}

export class ProjectOperations {
    constructor(private readonly operations: Operations, private readonly store: ProjectStateStore, private readonly cmake: CmakeService, private readonly registry?: ProjectRegistry, private readonly sourceLifetime?: Resource) { }

    async run<T>(root: string, access: ProjectAccess, label: string, body: () => Promise<T>): Promise<T> {
        for (; ;) {
            const planned = await this.store.deepLoad(root)
            const resources: Resource[] = [{ kind: "configuration", path: resolve(root), mode: access.configuration }]
            if (this.sourceLifetime) resources.push(this.sourceLifetime)
            const state = planned.state
            if (state) resources.push(...this.resources(state, access))
            let retry = false
            try {
                const result = await this.operations.run(resources, label, async () => {
                    const current = await this.store.deepLoad(root)
                    if (JSON.stringify(current.snapshots) !== JSON.stringify(planned.snapshots)) {
                        retry = true
                        return undefined
                    }
                    await this.operations.assert(resources)
                    if (!access.observe && current.state) await this.registry?.register(current.state.rootDir, this.cmake.buildAnchor(current.state))
                    return body()
                }, access.observe)
                if (!retry) return result as T
            } catch (error) { if (!(error instanceof ResourcePlanChanged)) throw error }
        }
    }

    assertSetup(state: ProjectState, scope: "UI" | "Native" | "Global"): Promise<void> {
        return this.operations.assert(this.resources(state, { configuration: "write", ui: scope === "Native" ? undefined : "write", nativeSource: scope === "UI" ? undefined : "read", native: scope === "UI" ? undefined : "write" }))
    }

    private resources(state: ProjectState, access: ProjectAccess): Resource[] {
        const resources: Resource[] = []
        if (access.liveServer) resources.push({ kind: "endpoint", path: defaultDevServerUrl, mode: "write" })
        if (access.ui) resources.push({ kind: "directory", path: uiDirectory(state), mode: access.ui })
        else resources.push({ kind: "directory", path: resolve(uiDirectory(state), "node_modules"), mode: "read" })
        if (access.nativeSource) resources.push({ kind: "directory", path: resolve(state.rootDir, state.project.native.directory), mode: access.nativeSource })
        if (access.native) {
            const prepared = state.local?.native ? state : { ...state, local: { ...state.local, native: { generator: defaultNativeGenerator, architecture: process.arch === "arm64" ? "arm64" as const : "x64" as const } } }
            if (!access.flavors) resources.push({ kind: "directory", path: dirname(this.cmake.buildDirectory(prepared, "debug")), mode: access.native })
            else for (const flavor of access.flavors) resources.push({ kind: "directory", path: this.cmake.buildDirectory(prepared, flavor), mode: access.native })
        }
        if (access.artifacts) resources.push({ kind: "directory", path: resolve(state.rootDir, state.project.artifacts.directory), mode: access.artifacts })
        return resources
    }
}
