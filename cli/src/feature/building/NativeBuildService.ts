import type { BuildFlavor, NativeProduct, ProjectState } from "../project/ProjectState.ts"
import type { CmakeModel, CmakeService } from "../cmake/CmakeService.ts"
import { nativeBuildRecordName, recordBuild } from "./BuildReceipt.ts"
import { nativePresentationSignature } from "../project/NativePresentation.ts"
import type { TaskOutput } from "../operation/Work.ts"

export class NativeBuildService {
    constructor(private readonly cmake: CmakeService) { }

    async build(state: ProjectState, flavor: BuildFlavor, products: readonly NativeProduct[], task: TaskOutput, clean = false, bytecodeCompiler = false): Promise<CmakeModel> {
        const presentationSignature = await this.cmake.presentationSignature(state)
        const { model } = await recordBuild(state, nativeBuildRecordName(state, flavor, this.cmake.platformName), { target: state.project.native.target, products, presentationSignature }, async () => {
            const model = await this.cmake.build(state, flavor, products, task, clean, bytecodeCompiler)
            if (presentationSignature !== await nativePresentationSignature(state, model.platform)) throw new Error("构建期间显示名、Bundle ID 或图标发生变化，请重新构建")
            const quickJsIdentity = await this.cmake.quickJsIdentity(model)
            const runtimeProtocol = await this.cmake.runtimeProtocol(model, state.project.framework.version)
            return { model, quickJsIdentity, runtimeProtocol }
        }, ({ model, quickJsIdentity, runtimeProtocol }) => ({ configuration: model.configuration, platform: model.platform, architecture: model.architecture, quickJsIdentity, runtimeProtocol }))
        return model
    }
}
