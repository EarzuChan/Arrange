import {join} from "node:path"
import type {JsonManagedItem, TextManagedItem} from "../managed/ManagedItem.ts"
import type {ProjectContext} from "../project/ProjectState.ts"
import {PackageJsonFrameworkDependencyRegion, PackageJsonNameRegion} from "./JsonRegions.ts"
import {NpmrcArrangeRegistryRegion} from "./TextRegions.ts"

export class PackageJsonNameItem implements JsonManagedItem {
    static readonly key = PackageJsonNameRegion.key

    readonly id = PackageJsonNameItem.key
    readonly kind = "json"

    filePath(context: ProjectContext): string {
        return join(context.state.project.ui.directory, "package.json")
    }

    resolveRegions() {
        return [new PackageJsonNameRegion()]
    }
}

export class PackageJsonFrameworkDependencyItem implements JsonManagedItem {
    static readonly key = PackageJsonFrameworkDependencyRegion.key

    readonly id = PackageJsonFrameworkDependencyItem.key
    readonly kind = "json"

    filePath(context: ProjectContext): string {
        return join(context.state.project.ui.directory, "package.json")
    }

    resolveRegions() {
        return [new PackageJsonFrameworkDependencyRegion()]
    }
}

export class NpmrcArrangeRegistryItem implements TextManagedItem {
    static readonly key = NpmrcArrangeRegistryRegion.key

    readonly id = NpmrcArrangeRegistryItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new NpmrcArrangeRegistryRegion()]
    }
}

export function createNodeManagedItems(): readonly (JsonManagedItem | TextManagedItem)[] {
    return [
        new PackageJsonNameItem(),
        new PackageJsonFrameworkDependencyItem(),
        new NpmrcArrangeRegistryItem(),
    ]
}
