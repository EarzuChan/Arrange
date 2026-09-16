import {BuildService} from "./building/BuildService.ts"
import {Packer} from "./packing/Packer.ts"
import {ProjectStateStore} from "./project/ProjectStateStore.ts"
import {SyncService} from "./sync/SyncService.ts"
import {SyncWizard} from "./wizard/Sync.ts"

export class ServiceHub {
    readonly projectStateStore = new ProjectStateStore()
    readonly syncWizard = new SyncWizard()
    readonly buildService = new BuildService()
    readonly packer = new Packer()
    private syncServiceInstance?: SyncService

    // SyncService 也从 Hub 取共享依赖，首次使用时再创建，避免模块初始化循环。FUCK：但我觉得这有病的，这依赖注入了个勾巴
    get syncService(): SyncService { return this.syncServiceInstance ??= new SyncService() }
}

export const serviceHub = new ServiceHub()
