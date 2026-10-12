import koffi from "koffi"

// 工作进程先加入 Job，再允许启动工具；所有工具与后代自动继承，句柄异常关闭时全部结束
export function ownWindowsJob(): { release(): void } | undefined {
    if (process.platform !== "win32") return undefined
    const library = koffi.load("kernel32.dll")
    const create = library.func("void * __stdcall CreateJobObjectW(void *, str16)")
    const set = library.func("bool __stdcall SetInformationJobObject(void *, int, void *, uint32)")
    const assign = library.func("bool __stdcall AssignProcessToJobObject(void *, void *)")
    const current = library.func("void * __stdcall GetCurrentProcess()")
    const close = library.func("bool __stdcall CloseHandle(void *)")
    const error = library.func("uint32 __stdcall GetLastError()")
    const job = create(null, null)
    if (!job) throw new Error(`创建受管进程 Job 失败（Win32 ${error()}）`)
    const info = Buffer.alloc(process.arch === "ia32" ? 112 : 144)
    info.writeUInt32LE(0x2000, 16)
    if (!set(job, 9, info, info.length) || !assign(job, current())) {
        close(job)
        throw new Error(`无法托管工作进程（Win32 ${error()}）`)
    }
    return {
        release: () => {
            info.writeUInt32LE(0, 16)
            if (!set(job, 9, info, info.length)) throw new Error(`无法释放受管进程 Job（Win32 ${error()}）`)
            close(job)
        }
    }
}
