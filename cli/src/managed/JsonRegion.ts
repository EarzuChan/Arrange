import type {ProjectState} from "../project/ProjectState.ts"

export type JsonValue = null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [key: string]: JsonValue }

export type JsonRegionResult = { readonly kind: "ok" } | { readonly kind: "missing" } | { readonly kind: "outdated"; readonly current: unknown; readonly expected: unknown }
    | { readonly kind: "extraneous"; readonly current: unknown } | { readonly kind: "invalid"; readonly message: string }

export type PathToken = string | number

// CHECK：还没看，得看看
export interface JsonRegion {
    readonly id: string
    readonly path: readonly PathToken[]

    check(state: ProjectState, json: unknown): JsonRegionResult

    edit(state: ProjectState, json: unknown): void
}