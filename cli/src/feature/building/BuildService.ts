import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import { ProjectService } from "../project/ProjectService.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { UiBuildService, uiScriptFormat } from "./UiBuildService.ts"
import { Packer, type PackResult } from "../packing/Packer.ts"
import type { TaskRunner } from "../operation/Work.ts"

import { runBuilds } from "./BuildTasks.ts"

export interface BuildOptions {
    readonly flavor: BuildFlavor
    readonly ui: boolean
    readonly native: boolean
    readonly products?: readonly NativeProduct[]
    readonly clean?: boolean
    readonly pack?: boolean
}

export function requiresNativeBuildTools(state: ProjectState, options: BuildOptions): boolean {
    return options.native || (options.ui && uiScriptFormat(state) === 'bytecode')
}

export type BuildOutcome =
    | { readonly kind: "packed", readonly result: PackResult, readonly state: ProjectState }
    | { readonly kind: "unpacked", readonly reason: "no-pack" | "partial-scope" }

export class BuildService {
    constructor(private readonly project: ProjectService, private readonly tools: ToolchainService, private readonly ui: UiBuildService, private readonly native: NativeBuildService, private readonly packer: Packer, private readonly tasks: TaskRunner) { }

    async build(rootDir: string, options: BuildOptions): Promise<BuildOutcome> {
        const { state, products } = await this.tasks.status("检查工程与本机工具", async () => {
            const state = await this.project.load(rootDir)
            const products = options.products?.length ? [...new Set(options.products)] : state.project.project.products
            if (products.some(product => !state.project.project.products.includes(product))) throw new Error("所选产品不在工程 products 中，请修改 YAML 后运行 sync")
            const requiresNative = requiresNativeBuildTools(state, options)
            const scope = options.ui && requiresNative ? "Global" : options.ui ? "UI" : "Native"
            await this.project.requireConfiguration(state, scope)
            const tools = await this.tools.inspect(state, scope)
            if (tools.issues.length || JSON.stringify(tools.local) !== JSON.stringify(state.local)) throw new Error("本机工具尚未准备或发生变化，请运行 arrange sync --setup")
            return { state, products }
        })
        await runBuilds(this.tasks, state, options.flavor, options.ui ? this.ui : undefined, options.native ? this.native : undefined, products, options.clean)
        if (!options.ui || !options.native) return { kind: "unpacked", reason: "partial-scope" }
        if (options.pack === false) return { kind: "unpacked", reason: "no-pack" }
        const result = await this.tasks.run({ id: "pack", title: "整理交付物", detail: options.flavor }, () => this.packer.pack(state, { flavor: options.flavor, products, clean: options.clean }))
        return { kind: "packed", result, state }
    }
}
