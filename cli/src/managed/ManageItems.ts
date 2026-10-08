import type { TextRegion } from "./TextRegion.ts"
import type { JsonRegion } from "./JsonRegion.ts"
export type Region = TextRegion | JsonRegion

export interface ManagedItemMetadata {
    readonly id: string
    readonly label: string
}

export interface ManagedItem extends ManagedItemMetadata {
    readonly regions: readonly Region[]
}
