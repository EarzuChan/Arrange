import type { ProjectState } from "./ProjectState.ts"

export interface ProjectContext {
    readonly rootDir: string
    readonly state: ProjectState
}
