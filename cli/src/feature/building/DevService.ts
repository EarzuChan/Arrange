import { defaultDevServerUrl, defaultDevReadinessPath } from "../../CliMetadata.ts"
import type { BuildFlavor } from "../project/ProjectState.ts"
import { ProjectService } from "../project/ProjectService.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NodeJsService } from "../nodejs/NodeJsService.ts"
import { CmakeService } from "../cmake/CmakeService.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { ArtifactLocator } from "../packing/ArtifactLocator.ts"
import { DevSupervisor, type LongRunningProcessSpec } from "../platform/DevSupervisor.ts"
import { Packer } from "../packing/Packer.ts"
import { UiBuildService } from "./UiBuildService.ts"
import { isJsonObject } from "../../util/Utils.ts"
import type { TaskEntry, TaskRunner } from "../operation/Work.ts"

export interface DevOptions { readonly flavor: BuildFlavor, readonly ui: boolean, readonly native: boolean, readonly signal?: AbortSignal }

export class DevService {
    constructor(private readonly project: ProjectService, private readonly tools: ToolchainService, private readonly node: NodeJsService, private readonly cmake: CmakeService, private readonly native: NativeBuildService, private readonly artifacts: ArtifactLocator, private readonly supervisor: DevSupervisor, private readonly ui: UiBuildService, private readonly packer: Packer, private readonly tasks: TaskRunner) { }

    async run(rootDir: string, options: DevOptions): Promise<number> {
        const state = await this.tasks.status("检查工程与本机工具", async () => {
            const state = await this.project.load(rootDir)
            const scope = options.ui && options.native ? "Global" : options.ui ? "UI" : "Native"
            await this.project.requireConfiguration(state, scope)
            const tools = await this.tools.inspect(state, scope)
            if (tools.issues.length || JSON.stringify(tools.local) !== JSON.stringify(state.local)) throw new Error("本机工具尚未准备，请运行 arrange sync --setup")
            return state
        })
        const processes: LongRunningProcessSpec[] = []
        if (options.ui && (!options.native || options.flavor === "debug")) {
            const result = await this.node.inspect(state)
            if (!result.ready) throw new Error(`${result.reason}；请运行 arrange sync --setup --ui`)
            processes.push({
                ...this.node.packageManagerSpec(state, ["run", "dev"]), name: "ui", title: "UI", detail: `vite · ${defaultDevServerUrl}`, readyUrl: `${defaultDevServerUrl}${defaultDevReadinessPath}`, readyCheck: async response => {
                    if (!response.headers.get("content-type")?.startsWith("application/json")) return false
                    const snapshot: unknown = await response.json()
                    return isJsonObject(snapshot) && typeof snapshot.entry === "string" && Array.isArray(snapshot.modules) && snapshot.modules.length > 0 && snapshot.modules.every(module => isJsonObject(module) && typeof module.url === "string" && typeof module.source === "string")
                }
            })
        }
        if (options.native) {
            if (!state.project.project.products.includes("standalone")) throw new Error("native dev 需要 Standalone，请启用该产品后 sync，或使用 --ui-only")
            const configured = await this.cmake.inspect(state, options.flavor)
            if (!configured.ready) throw new Error(`${configured.reason}；请运行 arrange sync --setup --native`)
            // release 需要打包内置 UI：UI 构建与 native 构建并行，都成功后再整理 Standalone
            const packaged = !(options.flavor === "debug" && options.ui)
            const entries: TaskEntry[] = [{ spec: { id: `build-native-${options.flavor}`, title: `构建 native · ${options.flavor}`, detail: "standalone", rootDir: state.rootDir }, run: output => this.native.build(state, options.flavor, ["standalone"], output) }]
            if (packaged && options.ui) entries.push({ spec: { id: "build-ui", title: "构建 UI", detail: `${state.project.ui.packageManager} run build`, rootDir: state.rootDir }, run: output => this.ui.build(state, output) })
            await this.tasks.all(entries)
            let binaryPath: string
            if (!packaged) binaryPath = (await this.artifacts.locateStandalone(state, options.flavor)).binaryPath
            else {
                const packed = await this.tasks.run({ id: "pack", title: "整理 Standalone", detail: options.flavor }, () => this.packer.pack(state, { flavor: options.flavor, products: ["standalone"] }))
                binaryPath = packed.products[0].binaryPath
            }
            processes.push({ command: binaryPath, args: [], name: "native", title: "Native", detail: `Standalone · ${options.flavor}`, env: { ARRANGE_DEV_SERVER: defaultDevServerUrl }, dependsOn: processes.length ? ["ui"] : [] })
        }
        const progress = this.tasks.processes()
        try { return await this.supervisor.run(processes, { signal: options.signal, progress, rootDir: state.rootDir }) } finally { await progress.close() }
    }
}
