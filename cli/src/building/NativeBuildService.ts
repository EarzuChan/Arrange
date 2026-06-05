import { CmakeConfigService } from "../cmake/CmakeConfigService.ts"
import { Executor } from "../platform/Executor.ts"
import type { ProjectContext } from "../project/ProjectState.ts"

export class NativeBuildService {
    constructor(private readonly cmake = new CmakeConfigService(), private readonly executor = new Executor(),) {}

    async buildTarget(context: ProjectContext, target: string): Promise<void> {
        await this.executor.run(this.cmake.createBuildSpec(context, target))
    }
}
