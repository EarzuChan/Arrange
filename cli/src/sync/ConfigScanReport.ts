import type { FileSnapshot } from "../util/FileUtils.ts"
import type { ManagedFile, ConfigScope } from "../managed/ManagedFile.ts"
import type { TextCluster } from "../managed/TextCluster.ts"
import type { TextRegion } from "../managed/TextRegion.ts"
import type { JsonRegion, JsonExpected, JsonPath } from "../managed/JsonRegion.ts"
import type { TextSpan } from "../managed/Wrapper.ts"

export interface ConfigTarget {
    readonly path: string
    readonly file: ManagedFile
    readonly cluster?: TextCluster
    readonly region?: TextRegion | JsonRegion
    readonly snapshot: FileSnapshot
}

export interface FatalIssue { readonly path: string, readonly cause: string, readonly message: string }

export interface ResolvableIssue { readonly target: ConfigTarget, readonly cause: "missing" | "damaged", readonly message: string }

export interface IdleResult { readonly target: ConfigTarget, readonly expected?: unknown, readonly actual?: unknown }

export type ApplicableUpdate = { readonly target: ConfigTarget, readonly cause: "outdated" } & (
    { readonly kind: "text", readonly span: TextSpan, readonly expected: string, readonly actual: string } |
    { readonly kind: "json", readonly jsonPath: JsonPath, readonly expected: JsonExpected, readonly actual: JsonExpected }
)

export interface ConfigScanReport {
    readonly scope: ConfigScope
    readonly fatal: FatalIssue[]
    readonly resolvable: ResolvableIssue[]
    readonly idle: IdleResult[]
    readonly applicable: ApplicableUpdate[]
}

export function targetLabel(target: ConfigTarget): string { return `${target.path}${target.region ? ` / ${target.region.id}` : target.cluster ? ` / ${target.cluster.id}` : ""}` }