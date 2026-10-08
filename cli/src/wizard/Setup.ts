import { confirm, isCancel, log } from "@clack/prompts"
import type { LocalDefinition } from "../project/ProjectState.ts"
import type { SetupScanReport } from "../sync/SetupScanReport.ts"
import type { SetupInteraction } from "../sync/SetupInteraction.ts"

export class SetupWizard implements SetupInteraction {
    report(report: SetupScanReport): void {
        console.log("[ArrangeCLI]", `SETUP ${report.scope}`)
        for (const issue of report.fatal) console.log("[ArrangeCLI]", `  Fatal ${issue.key}: ${issue.message}`)
        for (const issue of report.resolvable) console.log("[ArrangeCLI]", `  Resolvable ${issue.key}: ${issue.message}`)
        for (const item of report.idle) console.log("[ArrangeCLI]", `  Idle ${item}`)
        for (const task of report.applicable) console.log("[ArrangeCLI]", `  Applicable ${task.kind}${task.kind === "configure-native" ? ` ${task.flavor}` : task.reason ? `：${task.reason}` : ""}`)
        console.log("[ArrangeCLI]", `  Fatal ${report.fatal.length}, Resolvable ${report.resolvable.length}, Idle ${report.idle.length}, Applicable ${report.applicable.length}`)
    }

    async acceptTools(local: LocalDefinition): Promise<boolean> {
        log.info(`检测到以下本机工具：\n${JSON.stringify(local, null, 2)}`)
        const accepted = await confirm({ message: "保存并使用这些工具？", initialValue: true })
        return !isCancel(accepted) && accepted
    }

    async editTools(message: string): Promise<boolean> {

        log.info(`${message}\n可安装缺失工具，或编辑 arrange.local.yaml 指定可执行文件路径`)
        const accepted = await confirm({ message: "已修正工具，重新检测？", initialValue: true })
        return !isCancel(accepted) && accepted
    }

    message(message: string): void { console.log("[ArrangeCLI]", message) }
    failure(message: string): void { console.error("[ArrangeCLI]", message) }
}
