import {Command, Option} from "commander"
import type {SyncService} from "../sync/SyncService.ts"

export interface SyncCommandOptions {scan?: boolean, config?: boolean, setup?: boolean, ui?: boolean, native?: boolean}

export function registerSyncCommand(program: Command, syncService: SyncService): void {
    program.command("sync")
        .description("同步工程文件与开发准备状态")
        .option("--scan", "只扫描；有 Fatal 或 Resolvable 时返回非零状态")
        .addOption(new Option("--config", "只同步工程配置文件").conflicts("setup"))
        .addOption(new Option("--setup", "只准备开发环境").conflicts("config"))
        .addOption(new Option("--ui", "仅 UI 范围").conflicts("native"))
        .addOption(new Option("--native", "仅 native 范围").conflicts("ui"))
        .action(async (options: SyncCommandOptions) => {
            const result = await syncService.run({scanOnly: options.scan, configOnly: options.config, setupOnly: options.setup, uiOnly: options.ui, nativeOnly: options.native}, process.cwd())

            if (result.status !== "completed") process.exitCode = 1
        })
}
