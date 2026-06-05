import { ProjectConfigurer } from "../configuring/ProjectConfigurer.ts"
import type { ProjectContext } from "../project/ProjectContext.ts"
import type { SyncCheckReport } from "./SyncCheckReport.ts"

export class SyncPerformer {
    constructor(private readonly projectConfigurer: ProjectConfigurer) {}

    async perform(context: ProjectContext, report: SyncCheckReport): Promise<void> {
        void report
        // TODO：根据 SyncCheckReport 精确执行：配置项修复/更新、local 创建/验证；根据未就绪情况选择性执行 pm install、cmake configure
        await this.projectConfigurer.configure(context)
    }
}
