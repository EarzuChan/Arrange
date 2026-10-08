import type { LocalDefinition } from "../project/ProjectState.ts"
import type { SetupScanReport } from "./SetupScanReport.ts"

export interface SetupInteraction {
    report(report: SetupScanReport): void
    acceptTools(local: LocalDefinition): Promise<boolean>
    editTools(message: string): Promise<boolean>
    message(message: string): void
    failure(message: string): void
}
