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

export class TextFile {
    readonly kind = "text-file"

    constructor(readonly id: string, readonly scope: Exclude<ConfigScope, "Global">, readonly path: (state: ProjectState) => string, readonly clusters: readonly TextCluster[], private readonly content: (state: ProjectState) => string) {}

    make(state: ProjectState): string { return this.content(state) }

    async check(state: ProjectState, path: string) {
        const result = await readText(path)
        if (result.kind !== "Idle") return result

        const clusters = this.clusters.filter(cluster => cluster.regions.some(region => region.enabled(state))).map(cluster => ({cluster, result: cluster.check(state, result.text)}))

        return {kind: "Idle" as const, text: result.text, clusters}
    }
}

export class JsonFile {
    readonly kind = "json-file"

    constructor(readonly id: string, readonly scope: Exclude<ConfigScope, "Global">, readonly path: (state: ProjectState) => string, readonly regions: readonly JsonRegion[], private readonly content: (state: ProjectState) => JsonValue) {}

    make(state: ProjectState): string {
        const json = this.content(state)

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
