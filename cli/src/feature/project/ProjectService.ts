import { ProjectStateStore } from "./ProjectStateStore.ts"
import { FrameworkService } from "../framework/FrameworkService.ts"
import { ConfigurationReadiness } from "../sync/ConfigurationReadiness.ts"
import type { ProjectState } from "./ProjectState.ts"
import type { ConfigScope } from "../managed/ManagedFile.ts"

export class ProjectService {
    constructor(private readonly store: ProjectStateStore, private readonly framework: FrameworkService, private readonly configuration: ConfigurationReadiness) { }

    async load(rootDir: string): Promise<ProjectState> {
        const state = await this.store.load(rootDir)
        await this.framework.assertCompatible(state, "installed-first")
        return state
    }

    async requireConfiguration(state: ProjectState, scope: ConfigScope): Promise<void> {
        await this.configuration.assertReady(state, scope)
    }
}
