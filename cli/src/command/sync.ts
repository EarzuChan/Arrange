import type { Command } from "commander"
import type { CliServices } from "../services.ts"

export interface SyncCommandOptions {
    check?: boolean
    projectOnly?: boolean
    toolchainOnly?: boolean
    ui?: boolean
    native?: boolean
}

export function registerSyncCommand(program: Command, services: CliServices): void {
    program
        .command("sync")
        .description("Check and synchronize Arrange project state")
        .option("--check", "Only check sync state and exit non-zero when updates are required")
        .option("--project-only", "Only check or update project-managed configuration")
        .option("--toolchain-only", "Only check or update local toolchain state")
        .option("--ui", "Limit operation to UI side")
        .option("--native", "Limit operation to native side")
        .action(async (options: SyncCommandOptions) => {
            await services.syncService.run({
                checkOnly: Boolean(options.check),
                projectOnly: Boolean(options.projectOnly),
                toolchainOnly: Boolean(options.toolchainOnly),
                uiOnly: Boolean(options.ui),
                nativeOnly: Boolean(options.native),
            })
        })
}

