import type { ContainmentContext, ProcessContainer, ProcessContainment } from "./ProcessContainer.ts"
import { PosixProcessGroupContainment } from "./PosixProcessGroup.ts"
import { WindowsJobContainment } from "./WindowsJobContainer.ts"
import { WindowsTreeScanContainment } from "./WindowsTreeScan.ts"

// Job 优先；创建或加入失败时仅该进程退回扫描兜底，不影响整体
class WindowsContainment implements ProcessContainment {
    private readonly scan = new WindowsTreeScanContainment()
    private job: WindowsJobContainment | undefined

    constructor() {
        try { this.job = new WindowsJobContainment() } catch { this.job = undefined }
    }

    contain(pid: number, context: ContainmentContext): ProcessContainer {
        if (this.job) try { return this.job.contain(pid, context) } catch { }
        return this.scan.contain(pid, context)
    }
}

export function createContainment(platform: NodeJS.Platform): ProcessContainment {
    return platform === "win32" ? new WindowsContainment() : new PosixProcessGroupContainment()
}
