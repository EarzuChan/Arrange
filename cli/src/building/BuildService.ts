import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import { ProjectService } from "../project/ProjectService.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { UiBuildService } from "./UiBuildService.ts"
import { Packer, type PackResult } from "../packing/Packer.ts"
import type { TaskEntry, TaskRunner } from "../ui/Tasks.ts"

export interface BuildOptions {
    readonly flavor: BuildFlavor
    readonly ui: boolean
    readonly native: boolean
    readonly products?: readonly NativeProduct[]
    readonly clean?: boolean
    readonly pack?: boolean
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
            const scope = options.ui && options.native ? "Global" : options.ui ? "UI" : "Native"
            await this.project.requireConfiguration(state, scope)
            const tools = await this.tools.inspect(state, scope)
            if (tools.issues.length || JSON.stringify(tools.local) !== JSON.stringify(state.local)) throw new Error("本机工具尚未准备或发生变化，请运行 arrange sync --setup")
            return { state, products }
        })
        // UI 与 native 构建互不依赖，并行执行；任一失败时另一个跑完再一起报告，且不进入打包
        const entries: TaskEntry[] = []
        if (options.ui) entries.push({ spec: { id: "build-ui", title: "构建 UI", detail: `${state.project.ui.packageManager} run build`, rootDir: state.rootDir }, run: output => this.ui.build(state, output, options.clean) })
        if (options.native) entries.push({ spec: { id: `build-native-${options.flavor}`, title: `构建 native · ${options.flavor}`, detail: products.join(", "), rootDir: state.rootDir }, run: output => this.native.build(state, options.flavor, products, output, options.clean) })
        await this.tasks.all(entries)
        if (!options.ui || !options.native) return { kind: "unpacked", reason: "partial-scope" }
        if (options.pack === false) return { kind: "unpacked", reason: "no-pack" }
        const result = await this.tasks.run({ id: "pack", title: "整理交付物", detail: options.flavor }, () => this.packer.pack(state, { flavor: options.flavor, products, clean: options.clean }))
        return { kind: "packed", result, state }
    }
}
