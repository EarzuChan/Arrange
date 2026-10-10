import type { ConfigScanReport, ConfigTarget } from "../sync/ConfigScanReport.ts"
import type { SetupScanReport, SetupTask } from "../sync/SetupScanReport.ts"
import { displayPath } from "../ui/TaskLog.ts"
import type { Palette } from "../ui/Theme.ts"

// LSRA 扫描报告的呈现：标题行给出四类计数，下面只列需要关注的条目；只读扫描（--scan）时也列出 Idle

export interface ScanReportOptions {
    readonly listIdle?: boolean
}

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

function header(palette: Palette, title: string, counts: Counts): string {
    const count = (label: string, value: number, color: "red" | "yellow" | "cyan" | "dim"): string => value ? palette.paint(color, `${label} ${value}`) : palette.paint("dim", `${label} ${value}`)
    return `${title} — ${[count("Fatal", counts.fatal, "red"), count("Resolvable", counts.resolvable, "yellow"), count("Applicable", counts.applicable, "cyan"), count("Idle", counts.idle, "dim")].join(palette.paint("dim", " · "))}`
}

// 与托管标记一致：区块组写作 cluster:<id>，避免与同名区域混淆
export function configTargetLabel(target: ConfigTarget): string {
    const suffix = target.region ? ` / ${target.region.id}` : target.cluster ? ` / cluster:${target.cluster.id}` : ""
    return `${displayPath(target.path)}${suffix}`
}

export function renderConfigReport(report: ConfigScanReport, palette: Palette, options: ScanReportOptions = {}): RenderedReport {
    const counts = { fatal: report.fatal.length, resolvable: report.resolvable.length, applicable: report.applicable.length, idle: report.idle.length }
    const lines = [header(palette, `CONFIG ${report.scope}`, counts)]
    for (const issue of report.fatal) lines.push(`${palette.paint("red", "Fatal")}  ${displayPath(issue.path)}：${issue.cause} — ${issue.message}`)
    for (const issue of report.resolvable) lines.push(`${palette.paint("yellow", "Resolvable")}  ${configTargetLabel(issue.target)}：${issue.cause} — ${issue.message}`)
    for (const update of report.applicable) lines.push(`${palette.paint("cyan", "Applicable")}  ${configTargetLabel(update.target)}`)
    if (options.listIdle) for (const result of report.idle) lines.push(palette.paint("dim", `Idle  ${configTargetLabel(result.target)}`))
    return { tone: tone(counts), lines }
}

export function setupTaskLabel(task: SetupTask): string {
    return task.kind === "install-ui" ? `安装 UI 依赖${task.reason ? `：${task.reason}` : ""}` : `配置 native · ${task.flavor}`
}

export function renderSetupReport(report: SetupScanReport, palette: Palette, options: ScanReportOptions = {}): RenderedReport {
    const counts = { fatal: report.fatal.length, resolvable: report.resolvable.length, applicable: report.applicable.length, idle: report.idle.length }
    const lines = [header(palette, `SETUP ${report.scope}`, counts)]
    for (const issue of report.fatal) lines.push(`${palette.paint("red", "Fatal")}  ${issue.key}：${issue.message}`)
    for (const issue of report.resolvable) lines.push(`${palette.paint("yellow", "Resolvable")}  ${issue.key}：${issue.message}`)
    for (const task of report.applicable) lines.push(`${palette.paint("cyan", "Applicable")}  ${setupTaskLabel(task)}`)
    if (options.listIdle) for (const item of report.idle) lines.push(palette.paint("dim", `Idle  ${item}`))
    return { tone: tone(counts), lines }
}
