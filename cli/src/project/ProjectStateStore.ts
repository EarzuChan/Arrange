import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parse, stringify } from "yaml"
import { getLocalYamlPath, getProjectYamlPath } from "./ProjectFiles.ts"
import { projectStateFromDtos, projectStateToDtos } from "./ProjectStateMapper.ts"
import type { ProjectState } from "./ProjectState.ts"
import { localYamlSchema, projectYamlSchema } from "./ProjectStateSchema.ts"

export class ProjectStateStore {
    async load(rootDir: string): Promise<ProjectState> {
        const project = await this.readProjectYaml(rootDir)
        const local = await this.readLocalYaml(rootDir)
        return projectStateFromDtos(project, local)
    }

    async save(rootDir: string, state: ProjectState): Promise<void> {
        const dto = projectStateToDtos(state)
        await this.writeYaml(getProjectYamlPath(rootDir), projectYamlSchema.parse(dto.project))
        if (dto.local !== null) {
            await this.writeYaml(getLocalYamlPath(rootDir), localYamlSchema.parse(dto.local))
        }
    }

    private async readProjectYaml(rootDir: string) {
        const raw = await readFile(getProjectYamlPath(rootDir), "utf8")
        return projectYamlSchema.parse(parse(raw))
    }

    private async readLocalYaml(rootDir: string) {
        const path = getLocalYamlPath(rootDir)
        if (!existsSync(path)) {
            return null
        }

        const raw = await readFile(path, "utf8")
        return localYamlSchema.parse(parse(raw))
    }

    private async writeYaml(path: string, value: unknown): Promise<void> {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, stringify(value), "utf8")
    }
}
