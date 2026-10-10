import type { LocalDefinition } from "../project/ProjectState.ts"
import type { SetupScanReport } from "./SetupScanReport.ts"
import type { ScanReportOptions } from "../wizard/ScanReports.ts"

export interface SetupInteraction {
    report(report: SetupScanReport, options?: ScanReportOptions): void
    acceptTools(local: LocalDefinition, packageManager?: string): Promise<boolean>
    editTools(message: string): Promise<boolean>
    message(message: string): void
    failure(message: string): void
}
