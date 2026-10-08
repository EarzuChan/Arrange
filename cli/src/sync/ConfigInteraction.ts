import type { ConfigScanReport, ResolvableIssue } from "./ConfigScanReport.ts"
export type ResolveChoice = "create" | "wrap" | "marker" | "edit" | "abort"

export interface ConfigInteraction {
    report(report: ConfigScanReport): void
    choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice>
    edit(instructions: string): Promise<boolean>
    message(message: string): void
    failure(message: string): void
}
