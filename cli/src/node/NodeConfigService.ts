import type { ProjectContext } from "../project/ProjectContext.ts"

export class NodeConfigService {
    async checkPackageJsonState(context: ProjectContext): Promise<boolean> {
        void context
        // TODO：校验 package.json 中受托管项是否完整、可识别、与 ProjectState 一致
        return false
    }
}
