import type { Command } from "commander"
import type { ProjectInitializer } from "../project/ProjectInitializer.ts"
import type { SyncService } from "../sync/SyncService.ts"
import { ProjectInteractionCancelled, type ProjectInteraction } from "../project/ProjectInteraction.ts"
import { errorMessage } from "../util/Utils.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export interface CreateCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerCreateCommand(program: Command, initializer: ProjectInitializer, syncService: SyncService, interaction: ProjectInteraction): void {
    program.command("create").description("创建完整 Arrange 工程").option("--registry <url>", "Framework npm registry URL").option("--fetch-content <url>", "Framework CMake FetchContent Git URL")
        .action(async (options: CreateCommandOptions) => {
            let created = false
            try {
                const request = await interaction.create({ nodeRegistryUrl: options.registry, cmakeFetchContentUrl: options.fetchContent })
                if (!request) return
                const plan = await initializer.planCreate(request)
                if (!await interaction.confirmInitialization(plan, "创建工程文件")) return
                const state = await initializer.apply(plan)
                created = true
                interaction.message(`工程已创建：${state.rootDir}`)
                if (await interaction.confirm("立即运行完整 sync，准备开发环境？")) {
                    const result = await syncService.run({}, state.rootDir)
                    if (result.status !== "completed") {
                        process.exitCode = 1
                        interaction.failure("工程已创建；同步未完成，请进入工程根运行 arrange sync 继续")
                    }
                }
                if (state.rootDir !== process.cwd()) interaction.message(`工程根：${state.rootDir}；后续命令在该目录运行`)
            } catch (error) {
                if (isAbortError(error)) throw error
                if (error instanceof ProjectInteractionCancelled) {
                    interaction.message(created ? "工程已创建；已取消后续同步" : "已取消创建；未写工程文件")
                    return
                }
                interaction.failure(errorMessage(error))
                process.exitCode = 1
            }
        })
}
