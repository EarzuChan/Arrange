import { Command, Option } from "commander"
import { buildFlavorSchema, nativeProductSchema } from "../project/ProjectState.ts"
import { BuildService } from "../building/BuildService.ts"

export interface BuildCommandOptions {
    flavor?: "debug" | "release" | string
    uiOnly?: boolean
    nativeOnly?: boolean
    package?: boolean
    product?: string[]
    clean?: boolean
}

export function registerBuildCommand(program: Command, service: BuildService): void {
    program.command("build").description("构建 Arrange 工程，完整构建默认整理交付物").addOption(new Option("--flavor <flavor>", "构建配置").choices(["debug", "release"]).default("release")).addOption(new Option("--ui-only", "只构建 UI").conflicts("native-only")).addOption(new Option("--native-only", "只构建 native").conflicts("ui-only")).option("--no-package", "跳过打包").addOption(new Option("--product <product...>", "选择产品").choices(["standalone", "vst3"])).option("--clean", "清理本次所选构建范围")
        .action(async (options: BuildCommandOptions) => {
            await service.build(process.cwd(), { flavor: buildFlavorSchema.parse(options.flavor), ui: !options.nativeOnly, native: !options.uiOnly, products: options.product?.map(product => nativeProductSchema.parse(product)), package: options.package, clean: options.clean })
        })
}
