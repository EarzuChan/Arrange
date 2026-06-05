import type { ProjectContext } from "../project/ProjectContext.ts"

export interface PlatformCheckResult {
    readonly ok: boolean
    readonly message?: string
}

export abstract class PlatformService {
    abstract checkToolchain(context: ProjectContext): Promise<PlatformCheckResult>
}
