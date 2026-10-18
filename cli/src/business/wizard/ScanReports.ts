import type { ConfigScanReport, ConfigTarget } from "../../feature/sync/ConfigScanReport.ts"
import type { SetupScanReport, SetupTask } from "../../feature/sync/SetupScanReport.ts"
import { displayPath } from "../../feature/operation/WorkLog.ts"

// LSRA 扫描报告的呈现：标题行给出四类计数，下面只列需要关注的条目；只读扫描（--scan）时也列出 Idle

export type { ScanReportOptions } from "../../feature/sync/ScanReportOptions.ts"
import type { ScanReportOptions } from "../../feature/sync/ScanReportOptions.ts"

export type ReportTone = "error" | "warn" | "info" | "step"

export interface RenderedReport {
    readonly tone: ReportTone
    readonly lines: readonly string[]
}

interface Counts {
    readonly fatal: number
    readonly resolvable: number
    readonly applicable: number
    readonly idle: number
}

function tone(counts: Counts): ReportTone {
    return counts.fatal ? "error" : counts.resolvable ? "warn" : counts.applicable ? "info" : "step"
}

function header(title: string, counts: Counts): string {
    return title + ' — ' + ['Fatal ' + counts.fatal, 'Resolvable ' + counts.resolvable, 'Applicable ' + counts.applicable, 'Idle ' + counts.idle].join(' · ')
}

// 与托管标记一致：区块组写作 cluster:<id>，避免与同名区域混淆
export function configTargetLabel(target: ConfigTarget): string {
    const suffix = target.region ? ` / ${target.region.id}` : target.cluster ? ` / cluster:${target.cluster.id}` : ""
    return `${displayPath(target.path)}${suffix}`
}

export function renderConfigReport(report: ConfigScanReport, options: ScanReportOptions = {}): RenderedReport {
    const counts = { fatal: report.fatal.length, resolvable: report.resolvable.length, applicable: report.applicable.length, idle: report.idle.length }
    const lines = [header(`CONFIG ${report.scope}`, counts)]
    for (const issue of report.fatal) lines.push(`Fatal  ${displayPath(issue.path)}：${issue.cause} — ${issue.message}`)
    for (const issue of report.resolvable) lines.push(`Resolvable  ${configTargetLabel(issue.target)}：${issue.cause} — ${issue.message}`)
    for (const update of report.applicable) lines.push(`Applicable  ${configTargetLabel(update.target)}`)
    if (options.listIdle) for (const result of report.idle) lines.push(`Idle  ${configTargetLabel(result.target)}`)
    return { tone: tone(counts), lines }
}

export function setupTaskLabel(task: SetupTask): string {
    return task.kind === "install-ui" ? `安装 UI 依赖${task.reason ? `：${task.reason}` : ""}` : `配置 native · ${task.flavor}`
}

export function renderSetupReport(report: SetupScanReport, options: ScanReportOptions = {}): RenderedReport {
    const counts = { fatal: report.fatal.length, resolvable: report.resolvable.length, applicable: report.applicable.length, idle: report.idle.length }
    const lines = [header(`SETUP ${report.scope}`, counts)]
    for (const issue of report.fatal) lines.push(`Fatal  ${issue.key}：${issue.message}`)
    for (const issue of report.resolvable) lines.push(`Resolvable  ${issue.key}：${issue.message}`)
    for (const task of report.applicable) lines.push(`Applicable  ${setupTaskLabel(task)}`)
    if (options.listIdle) for (const item of report.idle) lines.push(`Idle  ${item}`)
    return { tone: tone(counts), lines }
}
