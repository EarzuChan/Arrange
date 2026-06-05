import type { ProjectContext } from "../project/ProjectState.ts"

export type ManagedItemStatus = "ok" | "missing" | "damaged" | "outdated" | "disabled"

export interface ManagedItemCheckResult {
    readonly key: string
    readonly status: ManagedItemStatus
    readonly message?: string
}

export interface ManagedItemRepairPlan {
    readonly key: string
    readonly requiresInteraction: boolean
    readonly summary: string
}

export interface ManagedItem {
    readonly key: string
    check(context: ProjectContext): Promise<ManagedItemCheckResult>
    planRepair(context: ProjectContext, result: ManagedItemCheckResult): Promise<ManagedItemRepairPlan>
    performRepair(context: ProjectContext, plan: ManagedItemRepairPlan): Promise<void>
}
