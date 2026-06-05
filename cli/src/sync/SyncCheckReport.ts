import type { ManagedItemCheckResult } from "../management/ManagedItem.ts"

export type SyncIssueSeverity = "info" | "warning" | "error"
export type SyncArea = "project" | "local" | "configured"

export interface SyncIssue {
    readonly area: SyncArea
    readonly severity: SyncIssueSeverity
    readonly code: string
    readonly message: string
}

export interface SyncCheckReport {
    readonly ok: boolean
    readonly managedItems: ManagedItemCheckResult[]
    readonly issues: SyncIssue[]
}
