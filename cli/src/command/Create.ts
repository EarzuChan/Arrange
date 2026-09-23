import type { Command } from "commander"
import { relative } from "node:path"
import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import { createInitialProjectState } from "../project/CreateProject.ts"
import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import { runCreateWizard } from "../wizard/Create.ts"

export interface CreateCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerCreateCommand(program: Command, store: ProjectStateStore, registry: FrameworkRegistryClient): void {
    program.command("create").description("Create a new Arrange project").option("--registry <url>", "Framework npm registry URL").option("--fetch-content <url>", "Framework CMake FetchContent Git URL")
        .action(async (options: CreateCommandOptions) => {
            const request = await runCreateWizard(registry, {
                nodeRegistryUrl: options.registry,
                cmakeFetchContentUrl: options.fetchContent,
            })

            if (!request) return

            const state = createInitialProjectState(request)
            // TODO：调用生成器生成文件
            await store.save(state)

            console.log('[ArrangeCLI]', `Project created:\n  root: ${state.rootDir}\n`)

            // TODO：询问用户是否立即运行 sync；sync 模块后续专项落地后接入

            if (state.rootDir !== process.cwd()) {
                console.log('[ArrangeCLI]', "")
                console.log('[ArrangeCLI]', "To continue work:")
                console.log('[ArrangeCLI]', `  cd ${shellPath(displayPath(state.rootDir))}`)
            }
        })
}

function displayPath(path: string): string {
    const relativePath = relative(process.cwd(), path)
    return relativePath && !relativePath.startsWith("..") ? relativePath : path
}

function shellPath(path: string): string {
    return /[\s"&|<>^]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path
}
