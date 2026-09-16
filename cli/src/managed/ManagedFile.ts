import {errorMessage} from "../util/Utils.ts"
import {readFile, stat} from "node:fs/promises"
import type {ProjectState} from "../project/ProjectState.ts"
import {TextCluster} from "./TextCluster.ts"
import {JsonRegion, setJsonPath, type JsonValue} from "./JsonRegion.ts"

export type ConfigScope = "Global" | "UI" | "Native"

async function readText(path: string) {
    try {
        if (!(await stat(path)).isFile()) return {kind: "Fatal" as const, cause: "read-error", message: "目标不是文件"}

        return {kind: "Idle" as const, text: await readFile(path, "utf8")}
    } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT"
        return missing ? {kind: "Resolvable" as const, cause: "missing" as const, message: "文件不存在"} : {kind: "Fatal" as const, cause: "read-error", message: errorMessage(error)}
    }
}

// THINKING：以前是自己的check只对自己负责。现在是还会级联探索子级。这不能说不干净，但也是某种设计😂

export abstract class TextFile {
    readonly kind = "text-file"

    abstract readonly id: string
    abstract readonly scope: Exclude<ConfigScope, "Global">
    abstract readonly clusters: readonly TextCluster[]

    abstract path(state: ProjectState): string

    abstract make(state: ProjectState): string

    async check(state: ProjectState, path: string) {
        const result = await readText(path)
        if (result.kind !== "Idle") return result

        const clusters = this.clusters.filter(cluster => cluster.regions.some(region => region.enabled(state))).map(cluster => ({cluster, result: cluster.check(state, result.text)}))

        return {kind: "Idle" as const, text: result.text, clusters}
    }
}

export abstract class JsonFile {
    readonly kind = "json-file"

    abstract readonly id: string
    abstract readonly scope: Exclude<ConfigScope, "Global">
    abstract readonly regions: readonly JsonRegion[]

    abstract path(state: ProjectState): string

    protected abstract makeContent(state: ProjectState): JsonValue

    make(state: ProjectState): string {
        const json = this.makeContent(state)

        for (const region of this.regions) setJsonPath(json, region.locate(state), region.make(state))

        return `${JSON.stringify(json, null, 2)}\n`
    }

    async check(state: ProjectState, path: string) {
        const result = await readText(path)
        if (result.kind !== "Idle") return result

        let json: JsonValue
        try { json = JSON.parse(result.text) } catch (error) { return {kind: "Fatal" as const, cause: "unparsable", message: errorMessage(error)} }

        const regions = this.regions.filter(region => region.enabled(state)).map(region => ({region, result: region.check(state, json)}))

        return {kind: "Idle" as const, text: result.text, regions}
    }
}

export type ManagedFile = TextFile | JsonFile
