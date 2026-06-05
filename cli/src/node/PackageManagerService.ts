import type { ProcessSpec } from "../platform/ProcessSpec.ts"
import type { ProjectContext } from "../project/ProjectContext.ts"

export class PackageManagerService {
    async checkInstalled(context: ProjectContext): Promise<boolean> {
        void context
        // TODO：检查 node_modules / lockfile / package manager 状态
        return false
    }

    createInstallSpec(context: ProjectContext): ProcessSpec {
        return {
            command: context.state.project.ui.packageManager,
            args: ["install"],
            cwd: context.state.project.ui.directory,
        }
    }

    createBuildSpec(context: ProjectContext): ProcessSpec {
        return {
            command: context.state.project.ui.packageManager,
            args: ["run", "build"],
            cwd: context.state.project.ui.directory,
        }
    }

    createDevSpec(context: ProjectContext): ProcessSpec {
        return {
            command: context.state.project.ui.packageManager,
            args: ["run", "dev"],
            cwd: context.state.project.ui.directory,
        }
    }
}
