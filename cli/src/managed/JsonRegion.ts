import type {ProjectState} from "../project/ProjectState.ts"

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [key: string]: JsonValue }

export type JsonRegionResult =
    | { readonly kind: "ok" }
    | { readonly kind: "missing" }
    | { readonly kind: "outdated"; readonly current: unknown; readonly expected: unknown }
    | { readonly kind: "extraneous"; readonly current: unknown }
    | { readonly kind: "invalid"; readonly message: string }

export interface JsonRegion {
    readonly id: string
    readonly path: readonly string[]

    check(state: ProjectState, json: unknown): JsonRegionResult

    edit(state: ProjectState, json: unknown): void
}
