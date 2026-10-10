import { confirm, isCancel } from "@clack/prompts"
import type { LocalDefinition } from "../project/ProjectState.ts"
import type { SetupScanReport } from "../sync/SetupScanReport.ts"
import type { SetupInteraction } from "../sync/SetupInteraction.ts"
import { padEnd, visibleWidth } from "../ui/Ansi.ts"
import type { CliTerminal } from "../ui/Terminal.ts"
import type { Palette } from "../ui/Theme.ts"
import { renderSetupReport, type ScanReportOptions } from "./ScanReports.ts"

// 本机工具清单：名称、版本、路径各一列
export function describeLocalTools(local: LocalDefinition, palette: Palette, packageManager?: string): string[] {
    const rows: [string, string, string][] = []
    const tool = (label: string, definition: { path: string, version?: string } | undefined): void => {
        if (definition) rows.push([label, definition.version ?? "", definition.path])
    }
    tool("Node.js", local.node)
    tool(packageManager ?? "包管理器", local.packageManager)
    tool("CMake", local.cmake)
    tool("Ninja", local.ninja)
    tool("C++ 编译器", local.nativeCompiler)
    if (local.native) rows.push(["原生环境", "", [local.native.generator, local.native.architecture, local.native.developerCommand ?? local.native.developerDirectory].filter(Boolean).join(" · ")])
    if (local.native?.buildRoot) rows.push(["构建根", "", local.native.buildRoot])
    for (const [key, value] of Object.entries(local.native?.cmakeDefinitions ?? {})) rows.push(["CMake 定义", "", `${key}=${value}`])
    const labelWidth = Math.max(...rows.map(row => visibleWidth(row[0])))
    const versionWidth = Math.max(0, ...rows.map(row => visibleWidth(row[1])))
    return rows.map(([label, version, path]) => `${padEnd(label, labelWidth)}  ${palette.paint("cyan", padEnd(version, versionWidth))}${versionWidth ? "  " : ""}${palette.paint("dim", path)}`)
}

export class SetupWizard implements SetupInteraction {
    constructor(private readonly output: CliTerminal) { }

    report(report: SetupScanReport, options?: ScanReportOptions): void {
        const rendered = renderSetupReport(report, this.output.screen.palette, options)
        this.output.reporter.toned(rendered.tone, rendered.lines)
    }

    async acceptTools(local: LocalDefinition, packageManager?: string): Promise<boolean> {
        this.output.reporter.info(["检测到以下本机工具：", ...describeLocalTools(local, this.output.screen.palette, packageManager)])
        const accepted = await confirm({ ...this.output.prompt, message: "保存并使用这些工具？", initialValue: true })
        return !isCancel(accepted) && accepted
    }

    async editTools(message: string): Promise<boolean> {
        this.output.reporter.warn([message, "可安装缺失工具，或编辑 arrange.local.yaml 指定可执行文件路径"])
        const accepted = await confirm({ ...this.output.prompt, message: "已修正工具，重新检测？", initialValue: true })
        return !isCancel(accepted) && accepted
    }

    message(message: string): void { this.output.reporter.step(message) }
    failure(message: string): void { this.output.reporter.error(message) }
}
