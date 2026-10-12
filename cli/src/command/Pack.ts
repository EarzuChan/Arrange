import { Command, Option } from "commander"
import { buildFlavorSchema, nativeProductSchema, type ProjectState } from "../project/ProjectState.ts"
import type { PackOptions, PackResult } from "../packing/Packer.ts"
import { describePackResult } from "../packing/PackReport.ts"
import type { Reporter } from "../ui/Reporter.ts"
import type { TaskRunner } from "../ui/Tasks.ts"

export interface PackCommandOptions {
    flavor?: "debug" | "release" | string
    product?: string[]
    clean?: boolean
}

export function registerPackCommand(program: Command, pack: (root: string, options: Omit<PackOptions, "products"> & { products?: PackOptions["products"] }) => Promise<{ state: ProjectState, result: PackResult }>, tasks: TaskRunner, reporter: Reporter): void {
    program.command("pack").description("整理已经构建的 UI/native 交付物").addOption(new Option("--flavor <flavor>", "产物配置").choices(["debug", "release"]).default("release")).addOption(new Option("--product <product...>", "选择产品").choices(["standalone", "vst3"])).option("--clean", "清理本次所选交付范围")
        .action(async (options: PackCommandOptions) => {
            const flavor = buildFlavorSchema.parse(options.flavor)
            reporter.intro(`arrange pack · ${flavor}`)
            const { state, result } = await tasks.run({ id: "pack", title: "整理交付物", detail: flavor, rootDir: process.cwd() }, () => pack(process.cwd(), { flavor, products: options.product?.map(product => nativeProductSchema.parse(product)), clean: options.clean }))
            reporter.success(await describePackResult(state, flavor, result))
            reporter.outro("打包完成")
        })
}
