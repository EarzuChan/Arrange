import { PackageManagerService } from "../node/PackageManagerService.ts"
import { Executor } from "../platform/Executor.ts"
import type { ProjectContext } from "../project/ProjectState.ts"

export class UiBuildService {
    constructor(private readonly packageManager = new PackageManagerService(), private readonly executor = new Executor(),) {}

    async build(context: ProjectContext): Promise<void> {
        await this.executor.run(this.packageManager.createBuildSpec(context))
    }
}
