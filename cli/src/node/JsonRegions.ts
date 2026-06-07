import type {JsonRegion, JsonRegionResult} from "../managed/JsonRegion.ts"
import type {ProjectState} from "../project/ProjectState.ts"
import {isJsonObject} from "../utils/utils.ts"

// 每个类内有私有的getExpected。现未采取缓存的模式

export class PackageJsonNameRegion implements JsonRegion {
    static readonly key = "node.package-json.name"

    readonly id = PackageJsonNameRegion.key
    readonly path = ["name"] as const

    private getExpected(state: ProjectState): string {
        return state.project.project.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "arrange-app"
    }

    check(state: ProjectState, json: unknown): JsonRegionResult {
        if (!isJsonObject(json)) return {kind: "invalid", message: "package.json root must be an object."}

        const expected = this.getExpected(state)
        if (!Object.prototype.hasOwnProperty.call(json, "name")) return {kind: "missing"}

        const current = json.name
        return JSON.stringify(current) === JSON.stringify(expected) ? {kind: "ok"} : {kind: "outdated", current, expected}
    }

    edit(state: ProjectState, json: unknown): void {
        if (!isJsonObject(json)) throw new Error("package.json root must be an object.")

        json.name = this.getExpected(state)
    }
}

export class PackageJsonFrameworkDependencyRegion implements JsonRegion {
    static readonly key = "node.package-json.framework-dependency"

    readonly id = PackageJsonFrameworkDependencyRegion.key
    readonly path = ["dependencies", "@arrange/framework"] as const

    private getExpected(state: ProjectState): string {
        const version = state.project.framework.version
        if (!version) throw new Error("framework.version is required.")

        return version
    }

    check(state: ProjectState, json: unknown): JsonRegionResult {
        const expected = state.project.framework.version
        if (!expected) return {kind: "invalid", message: "framework.version is required."}

        if (!isJsonObject(json)) return {kind: "invalid", message: "package.json root must be an object."}

        const dependencies = json.dependencies
        if (!isJsonObject(dependencies) || !Object.prototype.hasOwnProperty.call(dependencies, "@arrange/framework")) return {kind: "missing"}

        const current = dependencies["@arrange/framework"]
        return JSON.stringify(current) === JSON.stringify(expected) ? {kind: "ok"} : {kind: "outdated", current, expected}
    }

    edit(state: ProjectState, json: unknown): void {
        const expected = this.getExpected(state)

        if (!isJsonObject(json)) throw new Error("package.json root must be an object.")

        if (!isJsonObject(json.dependencies)) json.dependencies = {};

        (json.dependencies as Record<string, unknown>)["@arrange/framework"] = expected
    }
}
