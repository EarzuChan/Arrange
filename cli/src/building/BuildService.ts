import type { ProjectContext } from "../project/ProjectState.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { UiBuildService } from "./UiBuildService.ts"

export interface BuildOptions {
    readonly ui: boolean
    readonly native: boolean
    readonly nativeTargets: string[]
}

export class BuildService {
    constructor(private readonly uiBuildService = new UiBuildService(), private readonly nativeBuildService = new NativeBuildService(),) {}

    async build(context: ProjectContext, options: BuildOptions): Promise<void> {
        if (options.ui) await this.uiBuildService.build(context)
        if (options.native) for (const target of options.nativeTargets) await this.nativeBuildService.buildTarget(context, target)
    }
}
