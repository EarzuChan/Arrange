import { dirname } from "node:path"
import type { ProjectInitializer, InitializationPlan } from "../project/ProjectInitializer.ts"
import type { SyncService, SyncRunOptions } from "../sync/SyncService.ts"
import type { BuildService, BuildOptions } from "../building/BuildService.ts"
import type { DevService, DevOptions } from "../building/DevService.ts"
import type { ProjectService } from "../project/ProjectService.ts"
import type { Packer, PackOptions } from "../packing/Packer.ts"
import type { Operations } from "./Operations.ts"
import type { ProjectOperations, ProjectAccess } from "./ProjectOperations.ts"
import type { Resource } from "./Resource.ts"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"

// 命令边界一次声明完整资源集合；领域服务内的并行任务继承占用，不各自追加锁
export class ApplicationOperations {
    constructor(private readonly operations: Operations, private readonly projects: ProjectOperations, private readonly registry?: ProjectRegistry) { }

    initialize(initializer: ProjectInitializer, plan: InitializationPlan) {
        const resources: Resource[] = [{ kind: "initialization", path: plan.state.rootDir, mode: "write" }]
        for (const file of plan.files) resources.push({ kind: "directory", path: dirname(file.before.path), mode: "write" })
        for (const copy of plan.copies) resources.push({ kind: "directory", path: copy.source, mode: "read" }, { kind: "directory", path: copy.destination, mode: "write" })
        return this.operations.run(resources, "创建或接入工程", async () => {
            await this.registry?.register(plan.state.rootDir)
            return initializer.apply(plan)
        })
    }

    sync(service: SyncService, options: SyncRunOptions, root: string) {
        const mode = options.scanOnly ? "read" : "write"
        const access: ProjectAccess = { configuration: mode, ui: options.nativeOnly ? undefined : mode, nativeSource: options.uiOnly ? undefined : options.setupOnly ? "read" : mode, native: options.configOnly || options.uiOnly ? undefined : mode, observe: options.scanOnly }
        return this.projects.run(root, access, "arrange sync", () => service.run(options, root))
    }

    build(service: BuildService, root: string, options: BuildOptions) {
        const packed = options.ui && options.native && options.pack !== false
        return this.projects.run(root, { configuration: "read", ui: options.ui ? "write" : undefined, nativeSource: options.native ? "read" : undefined, native: options.native ? "write" : undefined, flavors: [options.flavor], artifacts: packed ? "write" : undefined }, "arrange build", () => service.build(root, options))
    }

    dev(service: DevService, root: string, options: DevOptions) {
        const packaged = options.native && !(options.flavor === "debug" && options.ui)
        return this.projects.run(root, { configuration: "read", ui: options.ui || packaged ? "write" : undefined, nativeSource: options.native ? "read" : undefined, native: options.native ? "write" : undefined, flavors: [options.flavor], artifacts: packaged ? "write" : undefined, liveServer: options.ui && (!options.native || options.flavor === "debug") }, "arrange dev", () => service.run(root, options))
    }

    pack(project: ProjectService, packer: Packer, root: string, options: Omit<PackOptions, "products"> & { products?: PackOptions["products"] }) {
        return this.projects.run(root, { configuration: "read", ui: "read", nativeSource: "read", native: "read", flavors: [options.flavor], artifacts: "write" }, "arrange pack", async () => {
            const state = await project.load(root)
            const result = await packer.pack(state, { ...options, products: options.products ?? state.project.project.products })
            return { state, result }
        })
    }
}
