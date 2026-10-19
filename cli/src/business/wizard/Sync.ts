import { confirm, isCancel, select } from "../../terminal/Prompts.ts"
import type { ConfigScanReport, ResolvableIssue } from "../../feature/sync/ConfigScanReport.ts"
import type { ResolveChoice } from "../../feature/sync/ConfigResolver.ts"
import type { ConfigInteraction } from "../../feature/sync/ConfigInteraction.ts"
import type { CommandInterface } from "../CommandInterface.ts"
import { configTargetLabel, renderConfigReport, type ScanReportOptions } from "./ScanReports.ts"
import { ScanPresentation } from '../ScanPresentation.ts'

const labels: Record<ResolveChoice, string> = { create: "确认创建", wrap: "给已有内容补 Wrapper", marker: "放置 Marker，新建内容", edit: "手动编辑修复", abort: "放弃同步" }

export class SyncWizard implements ConfigInteraction {
    constructor(output: CommandInterface, private readonly presentation = new ScanPresentation(output)) { }

    report(report: ConfigScanReport, options?: ScanReportOptions): void {
        const rendered = renderConfigReport(report, options)
        this.presentation.report(rendered.tone, rendered.lines, !!options?.listIdle || report.fatal.length > 0)
    }

    async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> {
        const result = await select({ ...this.presentation.current.prompt, message: `${configTargetLabel(issue.target)}：${issue.message}`, options: choices.map(value => ({ value, label: labels[value] })) })
        if (isCancel(result) || result === 'abort') this.presentation.complete()
        return isCancel(result) ? "abort" : result
    }

    async edit(instructions: string): Promise<boolean> {
        this.presentation.current.reporter.info(instructions)
        const result = await confirm({ ...this.presentation.current.prompt, message: "编辑完成，继续扫描？", initialValue: true })
        if (isCancel(result) || !result) this.presentation.complete()
        return !isCancel(result) && result
    }

    message(message: string, outcome?: 'completed'): void { this.presentation.message(message, outcome === 'completed') }
    failure(message: string): void { this.presentation.failure(message) }
}
