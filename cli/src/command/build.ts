import type { Command } from "commander"
import type { CliServices } from "../services.ts"

export interface BuildCommandOptions {
    flavor?: "debug" | "release" | string
    uiOnly?: boolean
    nativeOnly?: boolean
    package?: boolean
    product?: string[]
    clean?: boolean
}

export function registerBuildCommand(program: Command, services: CliServices): void {
    program
        .command("build")
        .description("Build Arrange project artifacts")
        .option("--flavor <flavor>", "Build flavor", "release")
        .option("--ui-only", "Build only UI artifacts")
        .option("--native-only", "Build only native artifacts")
        .option("--no-package", "Skip packaging step")
        .option("--product <product...>", "Native product(s) to build, for example standalone or vst3")
        .option("--clean", "Clean before building")
        .action(async (options: BuildCommandOptions) => {
            void options
            void services
            // TODO：BuildService 编排 UI/native build，并按需调用 Packer
        })
}

