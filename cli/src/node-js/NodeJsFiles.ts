import {resolve} from "node:path"
import {TextFile, JsonFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import {JsonRegion, type JsonValue} from "../managed/JsonRegion.ts"
import {managedItemIds} from "../managed/ManagedItem.ts"
import type {ProjectState} from "../project/ProjectState.ts"

export class RegistryRegion extends TextRegion {
    readonly id = "node.registry"
    readonly managedItemId = managedItemIds.registry

    protected override makeInner(state: ProjectState): string {
        const url = state.project.framework.nodeRegistryUrl
        return url == null ? "" : `@arrange:registry=${url}\n`
    }
}

export class RegistryCluster extends TextCluster {
    readonly id = "node.registry"
    readonly registryRegion = new RegistryRegion()
    readonly regions = [this.registryRegion]

    protected override makeInner(state: ProjectState): string {
        return this.registryRegion.make(state)
    }
}

export class NpmrcFile extends TextFile {
    readonly id = "npmrc"
    readonly scope = "UI"
    readonly registryCluster = new RegistryCluster()
    readonly clusters = [this.registryCluster]

    override path(state: ProjectState): string {
        return resolve(state.rootDir, state.project.ui.directory, ".npmrc")
    }

    override make(state: ProjectState): string {
        return this.registryCluster.make(state)
    }
}

export class PackageNameRegion extends JsonRegion {
    readonly id = "node.package-name"
    readonly managedItemId = managedItemIds.projectName
    protected readonly path = ["name"]

    protected override makeValue(state: ProjectState): string {
        return state.project.project.name.toLowerCase()
    }
}

export class FrameworkDependencyRegion extends JsonRegion {
    readonly id = "node.framework-dependency"
    readonly managedItemId = managedItemIds.frameworkVersion
    protected readonly path = ["dependencies", "@arrange/framework"]

    protected override makeValue(state: ProjectState): string {
        return state.project.framework.version
    }
}

export class PackageJsonFile extends JsonFile {
    readonly id = "package-json"
    readonly scope = "UI"
    readonly packageNameRegion = new PackageNameRegion()
    readonly frameworkDependencyRegion = new FrameworkDependencyRegion()
    readonly regions = [this.packageNameRegion, this.frameworkDependencyRegion]

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
}

export const npmrcFile = new NpmrcFile()
export const registryCluster = npmrcFile.registryCluster
export const registryRegion = registryCluster.registryRegion
export const packageJsonFile = new PackageJsonFile()
export const packageNameRegion = packageJsonFile.packageNameRegion
export const frameworkDependencyRegion = packageJsonFile.frameworkDependencyRegion
