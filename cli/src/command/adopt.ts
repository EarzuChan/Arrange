import type { Command } from "commander"
import type { CliServices } from "../services.ts"

export interface AdoptCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerAdoptCommand(program: Command, services: CliServices): void {
    program
        .command("adopt")
        .description("Adopt an existing project into Arrange")
        .option("--registry <url>", "Framework npm registry URL")
        .option("--fetch-content <url>", "Framework CMake FetchContent Git URL")
        .action(async (options: AdoptCommandOptions) => {
            void options
            void services
            // TODO：调用 AdoptWizard 等
            // adopt 的 raw 工程识别、托管选择、二次确认必须在专项流程中完成
        })
}
