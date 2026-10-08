import type { BuildFlavor, LocalDefinition, ProjectState } from "../project/ProjectState.ts"
import type { FileSnapshot } from "../util/FileUtils.ts"

export type SetupScope = "Global" | "UI" | "Native"
export interface SetupIssue { readonly key: string, readonly message: string }
export type SetupTask = { readonly kind: "install-ui", readonly reason?: string } | { readonly kind: "configure-native", readonly flavor: BuildFlavor }

export interface SetupScanReport {
    readonly scope: SetupScope
    readonly state: ProjectState | null
    readonly snapshots: readonly FileSnapshot[]
    readonly proposedLocal: LocalDefinition | null
    readonly fatal: readonly SetupIssue[]
    readonly resolvable: readonly SetupIssue[]
    readonly idle: readonly string[]
    readonly applicable: readonly SetupTask[]
}

export interface SetupResult {
    readonly status: "completed" | "blocked" | "aborted" | "failed"
    readonly report?: SetupScanReport
}
