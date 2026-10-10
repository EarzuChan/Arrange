import { confirm, isCancel, select } from "@clack/prompts"
import type { ConfigScanReport, ResolvableIssue } from "../sync/ConfigScanReport.ts"
import type { ResolveChoice } from "../sync/ConfigResolver.ts"
import type { ConfigInteraction } from "../sync/ConfigInteraction.ts"
import type { CliTerminal } from "../ui/Terminal.ts"
import { configTargetLabel, renderConfigReport, type ScanReportOptions } from "./ScanReports.ts"

const labels: Record<ResolveChoice, string> = { create: "确认创建", wrap: "给已有内容补 Wrapper", marker: "放置 Marker，新建内容", edit: "手动编辑修复", abort: "放弃同步" }

export class SyncWizard implements ConfigInteraction {
    constructor(private readonly output: CliTerminal) { }

    report(report: ConfigScanReport, options?: ScanReportOptions): void {
        const rendered = renderConfigReport(report, this.output.screen.palette, options)
        this.output.reporter.toned(rendered.tone, rendered.lines)
    }

    async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> {
        const result = await select({ ...this.output.prompt, message: `${configTargetLabel(issue.target)}：${issue.message}`, options: choices.map(value => ({ value, label: labels[value] })) })
        return isCancel(result) ? "abort" : result
    }

    async edit(instructions: string): Promise<boolean> {
        this.output.reporter.info(instructions)
        const result = await confirm({ ...this.output.prompt, message: "编辑完成，继续扫描？", initialValue: true })
        return !isCancel(result) && result
    }

    message(message: string): void { this.output.reporter.step(message) }
    failure(message: string): void { this.output.reporter.error(message) }
}
