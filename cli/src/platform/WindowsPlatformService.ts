import type { ProjectContext } from "../project/ProjectState.ts"
import { PlatformService, type PlatformCheckResult } from "./PlatformService.ts"

export class WindowsPlatformService extends PlatformService {
    async checkToolchain(context: ProjectContext): Promise<PlatformCheckResult> {
        void context
        // TODO：检查 Node/PM/CMake/MSVC/Ninja 等 Windows 开发工具链
        return { ok: false, message: "Windows toolchain check is not implemented" }
    }
}
