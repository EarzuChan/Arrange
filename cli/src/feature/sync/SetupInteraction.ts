import type { LocalDefinition } from "../project/ProjectState.ts"
import type { SetupScanReport } from "./SetupScanReport.ts"
import type { ScanReportOptions } from "./ScanReportOptions.ts"

export interface SetupInteraction {
    report(report: SetupScanReport, options?: ScanReportOptions): void
    acceptTools(local: LocalDefinition, packageManager?: string): Promise<boolean>
    editTools(message: string): Promise<boolean>
    message(message: string, outcome?: 'completed'): void
    failure(message: string): void
}
