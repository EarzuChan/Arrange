import type { ApplicationCommand } from "../ApplicationCommand.ts"
import type { ProjectInitializer } from "../../feature/project/ProjectInitializer.ts"
import type { SyncService } from "../../feature/sync/SyncService.ts"
import { ProjectInteractionCancelled, type ProjectInteraction } from "../../feature/project/ProjectInteraction.ts"
import { errorMessage } from "../../util/Utils.ts"
import { isAbortError } from "../../feature/platform/ProcessSpec.ts"
import type { Reporter } from "../../terminal/Reporter.ts"
import { projectLocationHint } from '../ProjectLocation.ts'

export interface CreateCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerCreateCommand(program: ApplicationCommand, initializer: Pick<ProjectInitializer, "planCreate" | "apply">, syncService: Pick<SyncService, "run">, interaction: ProjectInteraction, reporter: Reporter): void {
    program.command("create").description("创建完整 Arrange 工程").option("--registry <url>", "Framework npm 仓库地址").option("--fetch-content <url>", "Framework CMake FetchContent 的 Git 仓库地址")
        .action(async (options: CreateCommandOptions) => {
            let created = false
            let location = ''
            try {
                const request = await interaction.create({ nodeRegistryUrl: options.registry, cmakeFetchContentUrl: options.fetchContent })
                if (!request) return reporter.cancelled("已取消创建；未写工程文件")
                const plan = await initializer.planCreate(request)
                if (!await interaction.confirmInitialization(plan, "创建工程文件")) return reporter.cancelled("已取消创建；未写工程文件")
                const state = await initializer.apply(plan)
                created = true
                location = projectLocationHint(state.rootDir)
                interaction.message("工程已创建")
                if (!await interaction.confirm("立即运行完整 sync，准备开发环境？")) return reporter.outro(`工程已创建${location}，运行 arrange sync 准备开发环境`)
                const result = await syncService.run({}, state.rootDir)
                if (result.status !== "completed") {
                    reporter.fail(`工程已创建；同步未完成${location}，运行 arrange sync 继续`)
                    return 1
                }
                reporter.outro(`工程已创建，开发环境已就绪${location}`)
            } catch (error) {
                if (isAbortError(error)) throw error
                if (error instanceof ProjectInteractionCancelled) return reporter.cancelled(created ? "工程已创建；已取消后续同步" + location : "已取消创建；未写工程文件")
                reporter.fail(errorMessage(error) + location)
                return 1
            }
        })
}
