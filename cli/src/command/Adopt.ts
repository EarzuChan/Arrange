import type { Command } from "commander"
import type { ProjectInitializer } from "../project/ProjectInitializer.ts"
import type { SyncService } from "../sync/SyncService.ts"
import { ProjectInteractionCancelled, type ProjectInteraction } from "../project/ProjectInteraction.ts"
import { errorMessage } from "../util/Utils.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export interface AdoptCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerAdoptCommand(program: Command, initializer: ProjectInitializer, syncService: SyncService, interaction: ProjectInteraction): void {
    program.command("adopt").description("接入已有 UI/native 工程").option("--registry <url>", "Framework npm registry URL").option("--fetch-content <url>", "Framework CMake FetchContent Git URL")
        .action(async (options: AdoptCommandOptions) => {
            let initialized = false
            try {
                const request = await interaction.adopt({ nodeRegistryUrl: options.registry, cmakeFetchContentUrl: options.fetchContent })
                if (!request) return
                const plan = await initializer.planAdopt(request)
                if (!await interaction.confirmInitialization(plan, "保存配置并接入托管")) return
                const state = await initializer.apply(plan)
                initialized = true
                const config = await syncService.run({ configOnly: true }, state.rootDir)
                if (config.status !== "completed") {
                    process.exitCode = 1
                    interaction.failure("工程配置已保存；托管接入未完成，修改内容与事务记录已保留，可运行 arrange sync 继续")
                    return
                }
                interaction.message("工程托管已接入")
                if (await interaction.confirm("立即运行 SETUP，准备开发环境？")) {
                    const setup = await syncService.run({ setupOnly: true }, state.rootDir)
                    if (setup.status !== "completed") {
                        process.exitCode = 1
                        interaction.failure("工程托管已接入；环境准备未完成，可运行 arrange sync --setup 继续")
                    }
                }
            } catch (error) {
                if (isAbortError(error)) throw error
                if (error instanceof ProjectInteractionCancelled) {
                    interaction.message(initialized ? "工程配置与已完成修改已保留；已取消后续准备" : "已取消接入；未写工程文件")
                    return
                }
                interaction.failure(errorMessage(error))
                process.exitCode = 1
            }
        })
}
