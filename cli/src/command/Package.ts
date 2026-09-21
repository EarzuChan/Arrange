import type { Command } from "commander"

export interface PackageCommandOptions {
    flavor?: "debug" | "release" | string
    product?: string[]
    clean?: boolean
}

export function registerPackageCommand(program: Command): void {
    program.command("package").description("Package built Arrange artifacts").option("--flavor <flavor>", "Build flavor", "release").option("--product <product...>", "Native product(s) to package, for example standalone or vst3").option("--clean", "Clean package output before packaging")
        .action(async (options: PackageCommandOptions) => {
            void options
            // TODO：Packer 根据已构建工件生成发布产物
        })
}