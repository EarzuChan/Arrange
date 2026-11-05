import { waitUntil, type ContainmentContext, type ProcessContainer, type ProcessContainment } from "./ProcessContainer.ts"
import type { CleanupVerdict } from "./ProcessSpec.ts"

// 受管进程以独立进程组启动，组内成员就是它的全部后代（主动 setsid 脱离的除外）
export class PosixProcessGroupContainment implements ProcessContainment {
    contain(pid: number, _context: ContainmentContext): ProcessContainer {
        return new PosixProcessGroup(pid)
    }
}

class PosixProcessGroup implements ProcessContainer {
    constructor(private readonly pid: number) { }

    private alive(): boolean {
        try {
            process.kill(-this.pid, 0)
            return true
        } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" }
    }

    private signal(signal: NodeJS.Signals): void {
        try { process.kill(-this.pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    }

    async reap(signal: NodeJS.Signals, graceMs: number): Promise<CleanupVerdict> {
        if (!this.alive()) return "clean"
        this.signal(signal)
        if (await waitUntil(() => !this.alive(), graceMs)) return "reaped"
        this.signal("SIGKILL")
        return await waitUntil(() => !this.alive(), graceMs) ? "reaped" : "unknown"
    }

    releaseIfEmpty(): void { }
}
