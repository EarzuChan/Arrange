import type { CleanupVerdict, RunningProcess } from "../platform/ProcessSpec.ts"

// 工作进程内受管工具的清理账本：只有确认结束的工具才撤销登记，未确认的保持占用并可重试
export class ManagedProcesses {
    private readonly children = new Map<string, RunningProcess>()
    private readonly unconfirmed = new Set<string>()

    constructor(private readonly retire: (id: string) => Promise<void>) { }

    get pending(): boolean { return this.unconfirmed.size > 0 }

    add(id: string, child: RunningProcess): void { this.children.set(id, child) }

    // 启动失败、从未产生进程的登记可以直接撤销
    async discard(id: string): Promise<void> {
        await this.retire(id)
        this.children.delete(id)
        this.unconfirmed.delete(id)
    }

    // 清理动作本身出错同样视为未确认，不改变任务已有的结果
    async confirm(id: string): Promise<CleanupVerdict> {
        const child = this.children.get(id)
        if (!child) return "clean"
        let verdict: CleanupVerdict
        try { verdict = await child.stop() } catch { verdict = "unknown" }
        if (verdict === "unknown") this.unconfirmed.add(id)
        else await this.discard(id)
        return verdict
    }

    // 登记了主进程退出却仍未确认的工具：重新尝试，返回是否已全部确认
    async retry(): Promise<boolean> {
        await Promise.allSettled([...this.unconfirmed].map(id => this.confirm(id)))
        return !this.pending
    }

    // 关闭前停止全部工具，返回是否已全部确认
    async stopAll(): Promise<boolean> {
        await Promise.allSettled([...this.children.keys()].map(id => this.confirm(id)))
        return !this.pending
    }

    // 登记为未确认，由调用方在得知清理动作失败后使用
    markUnconfirmed(id: string): void { this.unconfirmed.add(id) }
}
