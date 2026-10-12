import koffi from "koffi"
import { closeSync, openSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import { operationPollMs } from "../CliMetadata.ts"

export interface KernelHandle { close(): void }

// 文件不删除；锁的生命周期由内核句柄决定，暂停或失去心跳不会转移所有权
export class KernelLock {
    private readonly acquire: (path: string) => KernelHandle | undefined

    constructor() {
        if (process.platform === "win32") {
            const library = koffi.load("kernel32.dll")
            const create = library.func("void * __stdcall CreateFileW(str16, uint32, uint32, void *, uint32, uint32, void *)")
            const close = library.func("bool __stdcall CloseHandle(void *)")
            const error = library.func("uint32 __stdcall GetLastError()")
            this.acquire = path => {
                const handle = create(path, 0xC0000000, 0, null, 4, 0x80, null)
                if (koffi.address(handle) === 0xFFFFFFFFFFFFFFFFn || koffi.address(handle) === 0xFFFFFFFFn) {
                    const code = error()
                    if (code === 32 || code === 33) return undefined
                    throw new Error(`无法取得系统文件锁：${path}（Win32 ${code}）`)
                }
                return { close: () => { if (!close(handle)) throw new Error(`无法释放系统文件锁：${path}`) } }
            }
        } else if (process.platform === "darwin") {
            const library = koffi.load("/usr/lib/libSystem.B.dylib")
            const flock = library.func("int flock(int, int)")
            this.acquire = path => {
                const fd = openSync(path, "a+")
                if (flock(fd, 2 | 4) !== 0) {
                    const code = koffi.errno()
                    closeSync(fd)
                    if (code === 11 || code === 35) return undefined
                    throw new Error(`无法取得系统文件锁：${path}（errno ${code}）`)
                }
                return { close: () => closeSync(fd) }
            }
        } else throw new Error(`Arrange 资源锁只支持 Windows 和 macOS：${process.platform}`)
    }

    tryAcquire(path: string): KernelHandle | undefined { return this.acquire(path) }
}

export async function withKernelLock<T>(path: string, signal: AbortSignal, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const kernel = new KernelLock()
    let handle: KernelHandle | undefined
    while (!(handle = kernel.tryAcquire(path))) await delay(operationPollMs, undefined, { signal })
    try {
        signal.throwIfAborted()
        return await body(signal)
    } finally { handle.close() }
}
