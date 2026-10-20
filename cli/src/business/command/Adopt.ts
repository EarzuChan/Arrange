import type { ApplicationCommand } from "../ApplicationCommand.ts"
import type { ProjectInitializer } from "../../feature/project/ProjectInitializer.ts"
import type { SyncService } from "../../feature/sync/SyncService.ts"
import { ProjectInteractionCancelled, type ProjectInteraction } from "../../feature/project/ProjectInteraction.ts"
import { errorMessage } from "../../util/Utils.ts"
import { isAbortError } from "../../feature/platform/ProcessSpec.ts"
import type { Reporter } from "../../terminal/Reporter.ts"
import { projectLocationHint } from '../ProjectLocation.ts'

export interface AdoptCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerAdoptCommand(program: ApplicationCommand, initializer: Pick<ProjectInitializer, "planAdopt" | "apply">, syncService: Pick<SyncService, "run">, interaction: ProjectInteraction, reporter: Reporter): void {
    program.command("adopt").description("接入已有 UI/native 工程").option("--registry <url>", "Framework npm 仓库地址").option("--fetch-content <url>", "Framework CMake FetchContent 的 Git 仓库地址")
        .action(async (options: AdoptCommandOptions) => {
            let initialized = false
            let location = ''
            try {
                const request = await interaction.adopt({ nodeRegistryUrl: options.registry, cmakeFetchContentUrl: options.fetchContent })
                if (!request) return reporter.warn("已取消接入；未写工程文件")

                const plan = await initializer.planAdopt(request)
                if (!await interaction.confirmInitialization(plan, "保存配置并接入托管")) return reporter.warn("已取消接入；未写工程文件")

                const state = await initializer.apply(plan)

                initialized = true
                location = projectLocationHint(state.rootDir)

                const config = await syncService.run({ configOnly: true }, state.rootDir)
                if (config.status !== "completed") {
                    reporter.error("工程配置已保存；托管接入未完成，修改内容与事务记录已保留" + location + "，运行 arrange sync 继续")
                    return 1
                }

                interaction.message("工程托管已接入")
                if (!await interaction.confirm("立即运行 SETUP，准备开发环境？")) return reporter.success("工程托管已接入" + location + "，运行 arrange sync --setup 准备开发环境")

                const setup = await syncService.run({ setupOnly: true }, state.rootDir)
                if (setup.status !== "completed") {
                    reporter.error("工程托管已接入；环境准备未完成" + location + "，运行 arrange sync --setup 继续")
                    return 1
                }

                reporter.success("工程托管已接入，开发环境已就绪" + location)
            } catch (error) {
                if (isAbortError(error)) throw error

                if (error instanceof ProjectInteractionCancelled) return reporter.warn(initialized ? "工程配置与已完成修改已保留；已取消后续准备" + location : "已取消接入；未写工程文件")

                reporter.error(errorMessage(error) + location)
                return 1
            }
        })
}
