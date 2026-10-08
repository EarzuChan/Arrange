import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { CmakeModel, CmakeService } from "../cmake/CmakeService.ts"
import { recordBuild } from "./BuildReceipt.ts"

export class NativeBuildService {
    constructor(private readonly cmake: CmakeService) { }

    async build(state: ProjectState, flavor: BuildFlavor, products: readonly NativeProduct[], clean = false): Promise<CmakeModel> {
        return recordBuild(state, `native-${flavor}`, { target: state.project.native.target, products }, () => this.cmake.build(state, flavor, products, clean), model => ({ configuration: model.configuration, platform: model.platform, architecture: model.architecture }))
    }
}
