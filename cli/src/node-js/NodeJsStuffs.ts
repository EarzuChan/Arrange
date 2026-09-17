import {resolve} from "node:path"
import {TextFile, JsonFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import {JsonRegion, type JsonValue} from "../managed/JsonRegion.ts"
import type {ProjectState} from "../project/ProjectState.ts"

export const registryRegion: TextRegion = new class extends TextRegion {
    readonly id = "node.registry"
    readonly managedItemId = "node.npmrc.arrange-registry"

    protected override makeInner(state: ProjectState): string {
        const url = state.project.framework.nodeRegistryUrl
        return url == null ? "" : `@arrange:registry=${url}\n`
    }
}()

export const registryCluster: TextCluster = new class extends TextCluster {
    readonly id = "node.registry"
    readonly regions = [registryRegion] as const

    protected override makeInner(state: ProjectState): string {
        return registryRegion.make(state)
    }
}()

export const npmrcFile: TextFile = new class extends TextFile {
    readonly id = "npmrc"
    readonly scope = "UI"
    readonly clusters = [registryCluster] as const

    override path(state: ProjectState): string {
        return resolve(state.rootDir, state.project.ui.directory, ".npmrc")
    }

    override make(state: ProjectState): string {
        return registryCluster.make(state)
    }
}()

export const packageNameRegion: JsonRegion = new class extends JsonRegion {
    readonly id = "node.package-name"
    readonly managedItemId = "project.name"
    protected readonly path = ["name"]

    protected override makeValue(state: ProjectState): string {
        return state.project.project.name.toLowerCase()
    }
}()

export const frameworkDependencyRegion: JsonRegion = new class extends JsonRegion {
    readonly id = "node.framework-dependency"
    readonly managedItemId = "framework.version"
    protected readonly path = ["dependencies", "@arrange/framework"]

    protected override makeValue(state: ProjectState): string {
        return state.project.framework.version
    }
}()

export const packageJsonFile: JsonFile = new class extends JsonFile {
    readonly id = "package-json"
    readonly scope = "UI"
    readonly regions = [packageNameRegion, frameworkDependencyRegion] as const

    override path(state: ProjectState): string {
        return resolve(state.rootDir, state.project.ui.directory, "package.json")
    }

    protected override makeContent(_state: ProjectState): JsonValue {
        return {
            private: true,
            type: "module",
            scripts: {dev: "vite", build: "vite build"},
        }
    }
}()
