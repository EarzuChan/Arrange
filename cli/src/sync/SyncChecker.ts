import { ConfigurationService } from "../managed/ConfigurationService.ts"
import type { ProjectContext } from "../project/ProjectState.ts"
import type { SyncCheckReport, SyncIssue } from "./SyncCheckReport.ts"

export class SyncChecker {
    constructor(private readonly configurationService = new ConfigurationService()) {}

    async check(context: ProjectContext): Promise<SyncCheckReport> {
        const managedItems = await this.configurationService.checkManagedItems(context)
        const issues: SyncIssue[] = []

        // TODO：check local toolchain availability；check UI deps / CMake configure ready state

        const hasBlockingIssue = issues.some((issue) => issue.severity === "error")
        const hasBadManagedItem = managedItems.some((item) => item.status !== "ok" && item.status !== "disabled")

        return {
            ok: !hasBlockingIssue && !hasBadManagedItem,
            managedItems,
            issues,
        }
    }
}
