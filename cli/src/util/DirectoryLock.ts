import lockfile from "proper-lockfile"
import { setTimeout as delay } from "node:timers/promises"
import { sourceLockRetryMs, sourceLockStaleMs, sourceLockUpdateMs, sourceLockWaitMs } from "../CliMetadata.ts"

// proper-lockfile 用 mkdir 与心跳处理跨进程互斥；失去锁时中止获取，禁止旧持有者发布
export async function withDirectoryLock<T>(path: string, signal: AbortSignal, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const compromised = new AbortController()
    const heldSignal = AbortSignal.any([signal, compromised.signal])
    const deadline = Date.now() + sourceLockWaitMs
    let release: (() => Promise<void>) | undefined
    while (!release) {
        heldSignal.throwIfAborted()
        try {
            release = await lockfile.lock(path, { realpath: false, stale: sourceLockStaleMs, update: sourceLockUpdateMs, retries: 0, onCompromised: error => compromised.abort(error) })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error
            if (Date.now() >= deadline) throw new Error(`等待 Arrange 目录锁超时：${path}`)
            await delay(sourceLockRetryMs, undefined, { signal: heldSignal })
        }
    }
    try {
        heldSignal.throwIfAborted()
        return await body(heldSignal)
    } finally {
        if (!compromised.signal.aborted) await release()
    }
}
