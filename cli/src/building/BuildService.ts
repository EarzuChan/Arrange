import type { BuildFlavor, NativeProduct } from "../project/ProjectState.ts"
import { ProjectService } from "../project/ProjectService.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { UiBuildService } from "./UiBuildService.ts"
import { Packer } from "../packing/Packer.ts"

export interface BuildOptions {
    readonly flavor: BuildFlavor
    readonly ui: boolean
    readonly native: boolean
    readonly products?: readonly NativeProduct[]
    readonly clean?: boolean
    readonly package?: boolean
}

export class BuildService {
    constructor(private readonly project: ProjectService, private readonly tools: ToolchainService, private readonly ui: UiBuildService, private readonly native: NativeBuildService, private readonly packer: Packer) { }

    async build(rootDir: string, options: BuildOptions): Promise<void> {
        const state = await this.project.load(rootDir)
        const products = options.products?.length ? [...new Set(options.products)] : state.project.project.products
        if (products.some(product => !state.project.project.products.includes(product))) throw new Error("所选产品不在工程 products 中，请修改 YAML 后运行 sync")
        const scope = options.ui && options.native ? "Global" : options.ui ? "UI" : "Native"
        await this.project.requireConfiguration(state, scope)
        const tools = await this.tools.inspect(state, scope)
        if (tools.issues.length || JSON.stringify(tools.local) !== JSON.stringify(state.local)) throw new Error("本机工具尚未准备或发生变化，请运行 arrange sync --setup")
        if (options.ui) await this.ui.build(state, options.clean)
        if (options.native) await this.native.build(state, options.flavor, products, options.clean)
        if (options.ui && options.native && options.package !== false) await this.packer.pack(state, { flavor: options.flavor, products, clean: options.clean })
        console.log("[ArrangeCLI]", "构建完成")
    }
}
