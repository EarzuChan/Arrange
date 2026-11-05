import { setTimeout as delay } from "node:timers/promises"
import { processReapPollMs } from "../../CliMetadata.ts"
import type { CleanupVerdict } from "./ProcessSpec.ts"

// 一个受管进程及其全部后代的归属；由平台提供精确的成员判定，不靠事后猜测
export interface ProcessContainer {
    // 结束全部成员并确认；graceMs 内无法确认时返回 unknown，可再次调用重试
    reap(signal: NodeJS.Signals, graceMs: number): Promise<CleanupVerdict>
    // 没有成员时释放系统资源；仍有成员时保持不变
    releaseIfEmpty(): void
}

export interface ContainmentContext {
    readonly startedAt: number
    exitedAt(): number | undefined
}

export interface ProcessContainment {
    contain(pid: number, context: ContainmentContext): ProcessContainer
}

export async function waitUntil(done: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (true) {
        if (done()) return true
        if (Date.now() >= deadline) return false
        await delay(processReapPollMs)
    }
}
