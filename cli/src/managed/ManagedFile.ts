import { errorMessage } from "../util/Utils.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import type { TextCluster } from "./TextCluster.ts"
import { JsonRegion, setJsonPath, type JsonValue } from "./JsonRegion.ts"
import type { FileCheckResult } from "./CheckResult.ts"

export type ConfigScope = "Global" | "UI" | "Native"

export abstract class TextFile {
    readonly kind = "text-file"

    abstract readonly id: string
    abstract readonly scope: Exclude<ConfigScope, "Global">
    abstract readonly clusters: readonly TextCluster[]

    abstract path(state: ProjectState): string

    abstract make(state: ProjectState): string

    check(_state: ProjectState, content: string | null): FileCheckResult<string> {
        return content === null ? { kind: "Resolvable", cause: "missing", message: "文件不存在" } : { kind: "Idle", value: content }
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

    check(_state: ProjectState, content: string | null): FileCheckResult<JsonValue> {
        if (content === null) return { kind: "Resolvable", cause: "missing", message: "文件不存在" }
        try { return { kind: "Idle", value: JSON.parse(content) as JsonValue } } catch (error) { return { kind: "Fatal", cause: "unparsable", message: errorMessage(error) } }
    }
}

export type ManagedFile = TextFile | JsonFile
