import { Option } from "commander"
import type { ApplicationCommand } from "../ApplicationCommand.ts"
import { buildFlavorSchema, nativeProductSchema } from "../../feature/project/ProjectState.ts"
import { BuildService } from "../../feature/building/BuildService.ts"
import { describePackResult } from "../report/PackReport.ts"
import type { Reporter } from "../../terminal/Reporter.ts"

export interface BuildCommandOptions {
    flavor?: "debug" | "release" | string
    uiOnly?: boolean
    nativeOnly?: boolean
    pack?: boolean
    product?: string[]
    clean?: boolean
}

export function registerBuildCommand(program: ApplicationCommand, service: Pick<BuildService, "build">, reporter: Reporter): void {
    program.command("build").description("构建 Arrange 工程，完整构建默认整理交付物").addOption(new Option("--flavor <flavor>", "构建配置").choices(["debug", "release"]).default("release")).addOption(new Option("--ui-only", "只构建 UI").conflicts("native-only")).addOption(new Option("--native-only", "只构建 native").conflicts("ui-only")).option("--no-pack", "跳过打包").addOption(new Option("--product <product...>", "选择产品").choices(["standalone", "vst3"])).option("--clean", "清理本次所选构建范围")
        .action(async (options: BuildCommandOptions) => {
            const flavor = buildFlavorSchema.parse(options.flavor)
            reporter.info(`arrange build · ${flavor}`)
            const outcome = await service.build(process.cwd(), { flavor, ui: !options.nativeOnly, native: !options.uiOnly, products: options.product?.map(product => nativeProductSchema.parse(product)), pack: options.pack, clean: options.clean })
            if (outcome.kind === "packed") reporter.success(await describePackResult(outcome.state, flavor, outcome.result))
            else reporter.info(outcome.reason === "no-pack" ? "已跳过打包（--no-pack）" : "未打包：需要同时构建 UI 与 native")
            reporter.success("构建完成")
        })
}
