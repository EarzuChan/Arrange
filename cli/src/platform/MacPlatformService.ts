import type { ProjectContext } from "../project/ProjectContext.ts"
import { PlatformService, type PlatformCheckResult } from "./PlatformService.ts"

export class MacPlatformService extends PlatformService {
    async checkToolchain(context: ProjectContext): Promise<PlatformCheckResult> {
        void context
        // TODO：检查 Node/PM/CMake/Xcode 等 macOS 开发工具链
        return { ok: false, message: "macOS toolchain check is not implemented" }
    }
}
