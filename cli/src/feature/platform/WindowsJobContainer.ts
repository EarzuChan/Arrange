import koffi from "koffi"
import { processExitDrainMs } from "../../CliMetadata.ts"
import { waitUntil, type ContainmentContext, type ProcessContainer, type ProcessContainment } from "./ProcessContainer.ts"
import type { CleanupVerdict } from "./ProcessSpec.ts"

// PROCESS_SET_QUOTA | PROCESS_TERMINATE，足以把进程放入 Job
const processAccess = 0x0101
const basicAccountingClass = 1
const basicAccountingSize = 48
const activeProcessesOffset = 40
const terminatedExitCode = 1

interface Kernel {
    create(security: null, name: null): unknown
    open(access: number, inherit: boolean, pid: number): unknown
    assign(job: unknown, process: unknown): boolean
    query(job: unknown, kind: number, info: Buffer, size: number, returned: null): boolean
    terminate(job: unknown, exitCode: number): boolean
    close(handle: unknown): boolean
    error(): number
}

function loadKernel(): Kernel {
    const library = koffi.load("kernel32.dll")
    return {
        create: library.func("void * __stdcall CreateJobObjectW(void *, str16)"),
        open: library.func("void * __stdcall OpenProcess(uint32, bool, uint32)"),
        assign: library.func("bool __stdcall AssignProcessToJobObject(void *, void *)"),
        query: library.func("bool __stdcall QueryInformationJobObject(void *, int, _Out_ void *, uint32, void *)"),
        terminate: library.func("bool __stdcall TerminateJobObject(void *, uint32)"),
        close: library.func("bool __stdcall CloseHandle(void *)"),
        error: library.func("uint32 __stdcall GetLastError()"),
    }
}

// 每个受管进程拥有独立 Job（嵌套在工作进程的 Job 之内）：成员数由内核回答，终止一次完成
export class WindowsJobContainment implements ProcessContainment {
    // 绑定必须在创建时完成：进程启动后到加入 Job 之间的耗时就是后代可能逃逸的窗口
    private readonly kernel = loadKernel()

    contain(pid: number, context: ContainmentContext): ProcessContainer {
        const kernel = this.kernel
        const job = kernel.create(null, null)
        if (!job) throw new Error(`创建进程 Job 失败（Win32 ${kernel.error()}）`)
        const handle = kernel.open(processAccess, false, pid)
        try {
            if (!handle) throw new Error(`打开进程失败（Win32 ${kernel.error()}）`)
            if (!kernel.assign(job, handle)) throw new Error(`加入进程 Job 失败（Win32 ${kernel.error()}）`)
        } catch (error) {
            kernel.close(job)
            throw error
        } finally { if (handle) kernel.close(handle) }
        return new WindowsJob(kernel, job, context)
    }
}

class WindowsJob implements ProcessContainer {
    private job: unknown | undefined

    constructor(private readonly kernel: Kernel, job: unknown, private readonly context: ContainmentContext) { this.job = job }

    // 已释放的 Job 没有成员；查询失败返回 undefined
    private active(): number | undefined {
        if (!this.job) return 0
        const info = Buffer.alloc(basicAccountingSize)
        return this.kernel.query(this.job, basicAccountingClass, info, info.length, null) ? info.readUInt32LE(activeProcessesOffset) : undefined
    }

    private release(): void {
        if (!this.job) return
        this.kernel.close(this.job)
        this.job = undefined
    }

    async reap(_signal: NodeJS.Signals, graceMs: number): Promise<CleanupVerdict> {
        const drained = this.active() === 0 || this.context.exitedAt() !== undefined && await waitUntil(() => this.active() === 0, processExitDrainMs)
        if (drained) {
            this.release()
            return "clean"
        }
        if (!this.kernel.terminate(this.job, terminatedExitCode)) throw new Error(`终止进程 Job 失败（Win32 ${this.kernel.error()}）`)
        if (!await waitUntil(() => this.active() === 0, graceMs)) return "unknown"
        this.release()
        return "reaped"
    }

    releaseIfEmpty(): void { if (this.active() === 0) this.release() }
}
