import type { WrappedLocation } from "./Wrapper.ts"

export type Located = Extract<WrappedLocation, { kind: "located" }>
export type StructureCheckResult<L> =
    | { readonly kind: "Resolvable", readonly cause: "missing" | "damaged", readonly message: string }
    | { readonly kind: "Idle", readonly location: L }

export type FileCheckResult<T> =
    | { readonly kind: "Fatal", readonly cause: "unparsable", readonly message: string }
    | { readonly kind: "Resolvable", readonly cause: "missing", readonly message: string }
    | { readonly kind: "Idle", readonly value: T }

export type CheckResult<T, L> =
    | { readonly kind: "Fatal", readonly cause: "config-invalid", readonly message: string }
    | { readonly kind: "Resolvable", readonly cause: "missing" | "damaged", readonly message: string, readonly expected?: T }
    | { readonly kind: "Idle", readonly actual: T, readonly expected: T, readonly location: L }
    | { readonly kind: "Applicable", readonly cause: "outdated", readonly actual: T, readonly expected: T, readonly location: L }
