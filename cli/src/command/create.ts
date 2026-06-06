import type {Command} from "commander"
import {relative} from "node:path"
import type {CliServices} from "../services.ts"
import {createInitialProjectState} from "../project/CreateProject.ts"
import {projectFileNames} from "../project/ProjectStateStore.ts"
import {runCreateWizard} from "../wizard/create.ts"

export interface CreateCommandOptions {
    registry?: string
    fetchContent?: string
}

export function registerCreateCommand(program: Command, services: CliServices): void {
    program
        .command("create")
        .description("Create a new Arrange project")
        .option("--registry <url>", "Framework npm registry URL")
        .option("--fetch-content <url>", "Framework CMake FetchContent Git URL")
        .action(async (options: CreateCommandOptions) => {
            const request = await runCreateWizard({
                nodeRegistryUrl: options.registry,
                cmakeFetchContentUrl: options.fetchContent,
            })

            if (!request) return

            const state = createInitialProjectState(request)
            const scaffold = await services.projectScaffoldGenerator.generate(request.rootDir, state, {pluginType: request.pluginType})
            await services.projectStateStore.save(request.rootDir, state)
            const writtenFiles = [...scaffold.writtenFiles, projectFileNames.project]

            console.log(`Project created:\n  root: ${request.rootDir}\n`)
            for (const file of writtenFiles) console.log(`  created ${file}`)

            // TODO：询问用户是否立即运行 sync；sync 模块后续专项落地后接入

            if (request.rootDir !== process.cwd()) {
                console.log("")
                console.log("To continue work:")
                console.log(`  cd ${shellPath(displayPath(request.rootDir))}`)
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
