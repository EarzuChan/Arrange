import {BuildService} from "./building/BuildService.ts"
import {ProjectConfigurer} from "./configuring/ProjectConfigurer.ts"
import {Packer} from "./packing/Packer.ts"
import {ProjectStateStore} from "./project/ProjectStateStore.ts"
import {createDefaultManagedItemRegistry, createDefaultTextClusterRegistry} from "./managed/DefaultManagedDefinitions.ts"
import {ManagedTopologyResolver} from "./managed/ManagedTopology.ts"
import {ConfigChecker} from "./sync/ConfigChecker.ts"
import {ConfigPerformer} from "./sync/ConfigPerformer.ts"
import {SyncService} from "./sync/SyncService.ts"

export interface CliServices {
    readonly projectStateStore: ProjectStateStore
    readonly syncService: SyncService
    readonly configChecker: ConfigChecker
    readonly configPerformer: ConfigPerformer
    readonly projectConfigurer: ProjectConfigurer
    readonly buildService: BuildService
    readonly packer: Packer
}

export function createCliServices(): CliServices {
    const projectStateStore = new ProjectStateStore()
    const managedItemRegistry = createDefaultManagedItemRegistry()
    const textClusterRegistry = createDefaultTextClusterRegistry()
    const managedTopologyResolver = new ManagedTopologyResolver(managedItemRegistry, textClusterRegistry)
    const configChecker = new ConfigChecker(managedTopologyResolver, textClusterRegistry)
    const configPerformer = new ConfigPerformer(managedTopologyResolver, textClusterRegistry)
    const projectConfigurer = new ProjectConfigurer()
    const syncService = new SyncService(projectStateStore, configChecker, configPerformer)
    const buildService = new BuildService()
    const packer = new Packer()

    return {projectStateStore, syncService, configChecker, configPerformer, projectConfigurer, buildService, packer}
}
