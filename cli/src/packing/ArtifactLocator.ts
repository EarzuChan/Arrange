import type { ProjectState } from "../project/ProjectState.ts"

export interface ArtifactLocation {
    readonly name: string
    readonly path: string
}

export class ArtifactLocator {
    async locate(context: ProjectState): Promise<ArtifactLocation[]> {
        void context
        // TODO：定位 UI/native 构建产物
        return []
    }
}