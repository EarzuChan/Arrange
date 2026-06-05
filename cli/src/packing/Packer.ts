import type { ProjectContext } from "../project/ProjectContext.ts"
import { ArtifactLocator } from "./ArtifactLocator.ts"

export class Packer {
    constructor(private readonly artifactLocator = new ArtifactLocator()) {}

    async pack(context: ProjectContext): Promise<void> {
        const artifacts = await this.artifactLocator.locate(context)
        void artifacts
        // TODO：根据 ArtifactLocator 结果生成最终 artifacts/ 工件
    }
}
