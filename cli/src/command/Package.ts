import { Command, Option } from "commander"
import { buildFlavorSchema, nativeProductSchema } from "../project/ProjectState.ts"
import { ProjectService } from "../project/ProjectService.ts"
import { Packer } from "../packing/Packer.ts"

export interface PackageCommandOptions {
    flavor?: "debug" | "release" | string
    product?: string[]
    clean?: boolean
}

export function registerPackageCommand(program: Command, project: ProjectService, packer: Packer): void {
    program.command("package").description("整理已经构建的 UI/native 交付物").addOption(new Option("--flavor <flavor>", "产物配置").choices(["debug", "release"]).default("release")).addOption(new Option("--product <product...>", "选择产品").choices(["standalone", "vst3"])).option("--clean", "清理本次所选交付范围")
        .action(async (options: PackageCommandOptions) => {
            const state = await project.load(process.cwd())
            const result = await packer.pack(state, { flavor: buildFlavorSchema.parse(options.flavor), products: options.product?.map(product => nativeProductSchema.parse(product)) ?? state.project.project.products, clean: options.clean })
            console.log("[ArrangeCLI]", `打包完成：${result.directory}`)
        })
}
