import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { CmakeModel, CmakeService } from "../cmake/CmakeService.ts"
import { recordBuild } from "./BuildReceipt.ts"
import { nativePresentationSignature } from "../project/NativePresentation.ts"

export class NativeBuildService {
    constructor(private readonly cmake: CmakeService) { }

    async build(state: ProjectState, flavor: BuildFlavor, products: readonly NativeProduct[], clean = false): Promise<CmakeModel> {
        const presentationSignature = await this.cmake.presentationSignature(state)
        return recordBuild(state, `native-${flavor}`, { target: state.project.native.target, products, presentationSignature }, async () => {
            const model = await this.cmake.build(state, flavor, products, clean)
            if (presentationSignature !== await nativePresentationSignature(state, model.platform)) throw new Error("构建期间显示名、Bundle ID 或图标发生变化，请重新构建")
            return model
        }, model => ({ configuration: model.configuration, platform: model.platform, architecture: model.architecture }))
    }
}
