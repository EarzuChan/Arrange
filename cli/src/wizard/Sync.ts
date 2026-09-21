import { confirm, isCancel, log, select } from "@clack/prompts"
import { targetLabel, type ConfigScanReport, type ResolvableIssue } from "../sync/ConfigScanReport.ts"
import type { ResolveChoice } from "../sync/ConfigResolver.ts"

const labels: Record<ResolveChoice, string> = { create: "确认创建", wrap: "给已有内容补 Wrapper", marker: "放置 Marker，新建内容", edit: "手动编辑修复", abort: "放弃同步" }

export class SyncWizard {
    report(report: ConfigScanReport): void {
        console.log(`CONFIG ${report.scope}`)
        for (const issue of report.fatal) console.log(`  Fatal ${issue.path}: ${issue.cause} — ${issue.message}`)
        for (const issue of report.resolvable) console.log(`  Resolvable ${targetLabel(issue.target)}: ${issue.cause} — ${issue.message}`)
        for (const result of report.idle) console.log(`  Idle ${targetLabel(result.target)}`)
        for (const update of report.applicable) console.log(`  Applicable ${targetLabel(update.target)}: outdated`)
        console.log(`  Fatal ${report.fatal.length}, Resolvable ${report.resolvable.length}, Idle ${report.idle.length}, Applicable ${report.applicable.length}`)
    }

    async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            console.error("需要交互处理，请在终端运行 sync --config。")
            return "abort"
        }
        const result = await select({ message: `${targetLabel(issue.target)}：${issue.message}`, options: choices.map(value => ({ value, label: labels[value] })) })
        return isCancel(result) ? "abort" : result
    }

    async edit(instructions: string): Promise<boolean> {
        log.info(instructions)
        const result = await confirm({ message: "编辑完成，继续扫描？", initialValue: true })
        return !isCancel(result) && result
    }

    message(message: string): void { console.log(message) }
}