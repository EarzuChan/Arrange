import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import {join} from "node:path"
import { parse, stringify} from "yaml"
import { localDefinitionSchema, projectDefinitionSchema, projectStateSchema, type ProjectState } from "./ProjectState.ts"
import {writeTextFile} from "../utils/utils.ts"

export const projectFileNames = {
    project: "arrange.project.yaml",
    local: "arrange.local.yaml",
} as const

export class ProjectStateStore {
    async load(rootDir: string): Promise<ProjectState> {
        const project = await this.readProjectYaml(rootDir)
        const local = await this.readLocalYaml(rootDir)

        return projectStateSchema.parse({project, local})
    }

    async save(rootDir: string, state: ProjectState): Promise<void> {
        const validatedState = projectStateSchema.parse(state)

        await writeTextFile(join(rootDir, projectFileNames.project), stringify(validatedState.project))

        if (validatedState.local !== null) await writeTextFile(join(rootDir, projectFileNames.local), stringify(validatedState.local))
    }

    private async readProjectYaml(rootDir: string) {
        const raw = await readFile(join(rootDir, projectFileNames.project), "utf8")
        return projectDefinitionSchema.parse(parse(raw))
    }

    private async readLocalYaml(rootDir: string) {
        const path = join(rootDir, projectFileNames.local)
        if (!existsSync(path)) return null

        const raw = await readFile(path, "utf8")
        return localDefinitionSchema.parse(parse(raw))
    }
}