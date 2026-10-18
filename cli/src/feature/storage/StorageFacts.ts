import type { InspectionFact } from "../../util/RecordInspection.ts"

export interface ReferenceFacts {
    readonly complete: boolean
    readonly paths: readonly string[]
    readonly blockers: readonly InspectionFact[]
}
export interface StorageItem {
    readonly id: string
    readonly kind: "project" | "build" | "deps-src" | "temporary"
    readonly path: string
    readonly root: string
    readonly owner?: string
    readonly bytes: number
    readonly sizeComplete: boolean
    readonly facts: readonly { readonly label: "record" | "content" | "ownership" | "project" | "preparation" | "index" | "transaction" | "occupancy", readonly check: InspectionFact }[]
    readonly references: ReferenceFacts
    readonly cleanup: { readonly allowed: boolean, readonly reason: string }
    readonly repairable?: boolean
}

export const emptyReferences: ReferenceFacts = { complete: true, paths: [], blockers: [] }
