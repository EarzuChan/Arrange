import { mkdir } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { CmakeProjectGenerator } from "../cmake/CmakeProjectGenerator.ts"
import { NodeProjectGenerator } from "../node/NodeProjectGenerator.ts"
import { writeTextFile } from "../utils/utils.ts"
import type { ProjectState } from "./ProjectState.ts"

export interface ProjectScaffoldResult {
    readonly writtenFiles: string[]
}

export class ProjectScaffoldGenerator {
    constructor(private readonly cmakeGenerator = new CmakeProjectGenerator(), private readonly nodeGenerator = new NodeProjectGenerator(),) {}

    async generate(rootDir: string, state: ProjectState): Promise<ProjectScaffoldResult> {
        const writtenFiles: string[] = []

        await mkdir(rootDir, { recursive: true })

        writtenFiles.push(...await this.writeRootFiles(rootDir, state))
        writtenFiles.push(...await this.nodeGenerator.generate(rootDir, state))
        writtenFiles.push(...await this.cmakeGenerator.generate(rootDir, state))

        return { writtenFiles: unique(writtenFiles) }
    }

    private async writeRootFiles(rootDir: string, state: ProjectState): Promise<string[]> {
        const files = [
            {
                path: resolve(rootDir, ".gitignore"),
                content: createGitignore(state), // CHECK：要这样么？思考一下
            },
        ]

        const written: string[] = []
        for (const file of files) {
            await writeTextFile(file.path, file.content)
            written.push(relative(rootDir, file.path))
        }
        return written
    }
}

function createGitignore(state: ProjectState): string {
    return [
        "# Arrange local state",
        "arrange.local.yaml",
        "",
        "# Arrange artifacts",
        `${state.project.artifacts.directory.replace(/\/+$/, "")}/`, // TIPS：根据当时设置的工件文件夹名字
        "",
        "# Node / TypeScript",
        "node_modules/",
        "dist/",
        ".vite/",
        "*.tsbuildinfo",
        "",
        "# CMake / C++",
        "build/",
        "cmake-build-*/",
        "CMakeFiles/",
        "CMakeCache.txt",
        "compile_commands.json",
        "",
        "# OS / editor",
        ".DS_Store",
        "Thumbs.db",
        ".idea/",
        ".vscode/",
        "",
    ].join("\n")
}

function unique(values: string[]): string[] {
    return [...new Set(values)]
}
