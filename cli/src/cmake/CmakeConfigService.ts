import type { ProcessSpec } from "../platform/ProcessSpec.ts"
import type { ProjectContext } from "../project/ProjectState.ts"

export class CmakeConfigService {
    async checkConfigureState(context: ProjectContext): Promise<boolean> {
        void context
        // TODO：判断 CMake 是否已经按当前 ProjectState configure 到可开发状态
        return false
    }

    createConfigureSpec(context: ProjectContext): ProcessSpec {
        void context
        // TODO：根据工程状态生成 cmake configure 命令规格，不直接 spawn
        return { command: "cmake", args: [] }
    }

    createBuildSpec(context: ProjectContext, target: string): ProcessSpec {
        void context
        return { command: "cmake", args: ["--build", ".", "--target", target] }
    }
}
