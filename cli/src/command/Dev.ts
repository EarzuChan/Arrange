import type { Command } from "commander"
import type { ServiceHub } from "../ServiceHub.ts"

export interface DevCommandOptions {
    uiOnly?: boolean
    nativeOnly?: boolean
    flavor?: "debug" | "release" | string
}

export function registerDevCommand(program: Command, services: ServiceHub): void {
    program
        .command("dev")
        .description("Run Arrange development environment")
        .option("--ui-only", "Run only UI dev server")
        .option("--native-only", "Run only native editor")
        .option("--flavor <flavor>", "Build flavor", "debug")
        .action(async (options: DevCommandOptions) => {
            void options
            void services
            // TODO：DevService 编排：sync check -> 可开发性判断 -> 必要构建 -> DevSupervisor 托管长进程
        })
}

