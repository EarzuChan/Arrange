import { spawn, type ChildProcess } from "node:child_process"
import type { ProcessSpec } from "../platform/ProcessSpec.ts"

export interface LongRunningProcessSpec extends ProcessSpec {
    readonly name: string
    readonly stopOnExit?: string[]
}

export class DevSupervisor {
    private readonly children = new Map<string, ChildProcess>()

    async run(processes: LongRunningProcessSpec[]): Promise<number> {
        void processes
        // TODO：启动并监管 Vite dev server / native editor：信号转发、子进程退出策略、错误归一化
        return 0
    }

    protected spawnProcess(spec: LongRunningProcessSpec): ChildProcess {
        const child = spawn(spec.command, spec.args, {
            cwd: spec.cwd,
            env: spec.env ? { ...process.env, ...spec.env } : process.env,
            stdio: "inherit",
            shell: process.platform === "win32",
        })
        this.children.set(spec.name, child)
        return child
    }

    protected stopAll(): void {
        for (const child of this.children.values()) child.kill()

        this.children.clear()
    }
}
