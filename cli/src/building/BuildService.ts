import type { ProjectState } from "../project/ProjectState.ts"
import { NativeBuildService } from "./NativeBuildService.ts"
import { UiBuildService } from "./UiBuildService.ts"

export interface BuildOptions {
    readonly ui: boolean
    readonly native: boolean
    readonly nativeTargets: string[]
}

export class BuildService {
    constructor(private readonly uiBuildService = new UiBuildService(), private readonly nativeBuildService = new NativeBuildService()) {}

    async build(context: ProjectState, options: BuildOptions): Promise<void> {
        // TODO
    }
}
