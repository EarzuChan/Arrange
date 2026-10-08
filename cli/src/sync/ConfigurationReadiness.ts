import type { ConfigScope } from "../managed/ManagedFile.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { ConfigScanner } from "./ConfigScanner.ts"
import type { ConfigInteraction } from "./ConfigInteraction.ts"

export class ConfigurationReadiness {
    constructor(private readonly scanner: ConfigScanner, private readonly interaction: ConfigInteraction) { }

    async assertReady(state: ProjectState, scope: ConfigScope): Promise<void> {
        const report = await this.scanner.scan(state, scope)
        if (!report.fatal.length && !report.resolvable.length && !report.applicable.length) return
        this.interaction.report(report)
        throw new Error("工程配置尚未同步，请运行 arrange sync --config")
    }
}
