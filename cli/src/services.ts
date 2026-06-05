import {BuildService} from "./building/BuildService.ts"
import {ProjectConfigurer} from "./configuring/ProjectConfigurer.ts"
import {Packer} from "./packing/Packer.ts"
import {ProjectScaffoldGenerator} from "./project/ProjectScaffoldGenerator.ts"
import {ProjectStateStore} from "./project/ProjectStateStore.ts"
import {SyncChecker} from "./sync/SyncChecker.ts"
import {SyncPerformer} from "./sync/SyncPerformer.ts"
import {SyncService} from "./sync/SyncService.ts"

export interface CliServices {
    readonly projectStateStore: ProjectStateStore
    readonly projectScaffoldGenerator: ProjectScaffoldGenerator
    readonly syncService: SyncService
    readonly syncChecker: SyncChecker
    readonly syncPerformer: SyncPerformer
    readonly projectConfigurer: ProjectConfigurer
    readonly buildService: BuildService
    readonly packer: Packer
}

export function createCliServices(): CliServices {
    const projectStateStore = new ProjectStateStore()
    const syncChecker = new SyncChecker()
    const projectConfigurer = new ProjectConfigurer()
    const syncPerformer = new SyncPerformer(projectConfigurer)
    const syncService = new SyncService(projectStateStore, syncChecker, syncPerformer)
    const projectScaffoldGenerator = new ProjectScaffoldGenerator()
    const buildService = new BuildService()
    const packer = new Packer()

    return {projectStateStore, projectScaffoldGenerator, syncService, syncChecker, syncPerformer, projectConfigurer, buildService, packer}
}