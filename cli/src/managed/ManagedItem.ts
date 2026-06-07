import type {ProjectContext} from "../project/ProjectState.ts"
import type {JsonRegion} from "./JsonRegion.ts"
import type {TextRegion} from "./TextRegion.ts"

export interface TextManagedItem {
    readonly id: string
    readonly kind: "text"

    resolveRegions(context: ProjectContext): readonly TextRegion[]
}

export interface JsonManagedItem {
    readonly id: string
    readonly kind: "json"

    filePath(context: ProjectContext): string

    resolveRegions(context: ProjectContext): readonly JsonRegion[]
}

export type ManagedItem = TextManagedItem | JsonManagedItem
