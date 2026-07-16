import type { Command } from "commander"
import type { CliServices } from "../services.ts"

export interface SyncCommandOptions { // 对齐 SyncRunOptions
    scan: boolean

    configOnly: boolean
    setupOnly: boolean

    ui: boolean
    native: boolean
}

export function registerSyncCommand(program: Command, services: CliServices): void {
    program
        .command("sync")
        .description("Synchronize Arrange project state")
        .option("--scan", "Only check sync state and exit non-zero when updates are required")
        .option("--config-only", "Only check or update project-managed configuration")
        .option("--setup-only", "Only check or update local toolchain state")
        .option("--ui", "Limit operation to UI subproject")
        .option("--native", "Limit operation to native subproject")
        .action(async (options: SyncCommandOptions) => {
            await services.syncService.run({
                scanOnly: Boolean(options.scan),
                configOnly: Boolean(options.configOnly),
                setupOnly: Boolean(options.setupOnly),
                uiOnly: Boolean(options.ui),
                nativeOnly: Boolean(options.native),
            },await services.projectStateStore.load(process.cwd()))
        })
}

