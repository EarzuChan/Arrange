import { CmakeConfigService } from "../cmake/CmakeConfigService.ts"
import { PackageManagerService } from "../node/PackageManagerService.ts"
import { Executor } from "../platform/Executor.ts"
import type { ProjectContext } from "../project/ProjectContext.ts"

export class ProjectConfigurer {
    constructor(private readonly cmake = new CmakeConfigService(), private readonly packageManager = new PackageManagerService(), private readonly executor = new Executor(),) {}

    async configure(context: ProjectContext): Promise<void> {
        await this.executor.run(this.packageManager.createInstallSpec(context))
        await this.executor.run(this.cmake.createConfigureSpec(context))
    }
}
