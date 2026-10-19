import type { ConfigScanReport, ResolvableIssue } from "./ConfigScanReport.ts"
import type { ScanReportOptions } from "./ScanReportOptions.ts"
export type ResolveChoice = "create" | "wrap" | "marker" | "edit" | "abort"

export interface ConfigInteraction {
    report(report: ConfigScanReport, options?: ScanReportOptions): void
    choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice>
    edit(instructions: string): Promise<boolean>
    message(message: string, outcome?: 'completed'): void
    failure(message: string): void
}
