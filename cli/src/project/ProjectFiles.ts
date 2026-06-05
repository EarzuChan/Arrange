import { join } from "node:path"

export const projectFileNames = {
    project: "arrange.project.yaml",
    local: "arrange.local.yaml",
} as const

export function getProjectYamlPath(rootDir: string): string {
    return join(rootDir, projectFileNames.project)
}

export function getLocalYamlPath(rootDir: string): string {
    return join(rootDir, projectFileNames.local)
}
