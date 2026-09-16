import {BuildService} from "./building/BuildService.ts"
import {Packer} from "./packing/Packer.ts"
import {ProjectStateStore} from "./project/ProjectStateStore.ts"
import {SyncService} from "./sync/SyncService.ts"

export interface ServiceHub {
    readonly projectStateStore: ProjectStateStore
    readonly syncService: SyncService
    readonly buildService: BuildService
    readonly packer: Packer
}

export function createServiceHub(): ServiceHub {
    const projectStateStore = new ProjectStateStore()
    return {projectStateStore, syncService: new SyncService(), buildService: new BuildService(), packer: new Packer()}
}
