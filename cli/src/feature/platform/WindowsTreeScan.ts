import { spawn } from "node:child_process"
import { join } from "node:path"
import { processTreeScanTimeoutMs } from "../../CliMetadata.ts"
import type { ContainmentContext, ProcessContainer, ProcessContainment } from "./ProcessContainer.ts"
import type { CleanupVerdict } from "./ProcessSpec.ts"

// Job 不可用时的兜底：靠 taskkill 或按父子关系与创建时间窗口枚举后代，只能尽力而为
export class WindowsTreeScanContainment implements ProcessContainment {
    contain(pid: number, context: ContainmentContext): ProcessContainer {
        return new WindowsTreeScan(pid, context)
    }
}

class WindowsTreeScan implements ProcessContainer {
    constructor(private readonly pid: number, private readonly context: ContainmentContext) { }

    async reap(_signal: NodeJS.Signals, graceMs: number): Promise<CleanupVerdict> {
        const exitedAt = this.context.exitedAt()
        if (exitedAt === undefined && await this.taskkill(graceMs * 2)) return "reaped"
        return this.scan(exitedAt ?? Date.now())
    }

    releaseIfEmpty(): void { }

    private taskkill(timeoutMs: number): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const killer = spawn("taskkill.exe", ["/pid", String(this.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" })
            const timeout = setTimeout(() => {
                killer.kill()
                resolve(false)
            }, timeoutMs)
            killer.once("error", () => {
                clearTimeout(timeout)
                resolve(false)
            })
            killer.once("close", code => {
                clearTimeout(timeout)
                resolve(code === 0)
            })
        })
    }

    private scan(cutoff: number): Promise<CleanupVerdict> {
        const { startedAt } = this.context
        const exited = this.context.exitedAt() !== undefined
        const window = `$p.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime -and $p.CreationDate.ToUniversalTime() -le [DateTimeOffset]::FromUnixTimeMilliseconds(${cutoff}).UtcDateTime`
        const script = `
$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$seen=@{}
$killed=0
$pending=[System.Collections.Generic.Queue[uint32]]::new()
foreach($p in $all) {
    if(${exited ? "$false" : "$true"} -and $p.ProcessId -eq ${this.pid} -and ${window}) { $pending.Enqueue([uint32]$p.ProcessId) }
    if($p.ParentProcessId -eq ${this.pid} -and ${window}) { $pending.Enqueue([uint32]$p.ProcessId) }
}
while($pending.Count) {
    $id=$pending.Dequeue()
    if($seen.ContainsKey($id)) { continue }
    $seen[$id]=$true
    foreach($p in $all) { if($p.ParentProcessId -eq $id) { $pending.Enqueue([uint32]$p.ProcessId) } }
    try { Stop-Process -Id $id -Force -ErrorAction Stop; $killed++ }
    catch { if(Get-Process -Id $id -ErrorAction SilentlyContinue) { throw } }
}
[Console]::Out.Write($killed)`
        const command = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe"
        return new Promise<CleanupVerdict>((resolve, reject) => {
            const cleaner = spawn(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
            let output = ""
            cleaner.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8") })
            // 超时只说明无法确认，不等于失败；调用方保留占用并可重试
            const timeout = setTimeout(() => {
                cleaner.kill()
                resolve("unknown")
            }, processTreeScanTimeoutMs)
            cleaner.once("error", error => {
                clearTimeout(timeout)
                reject(error)
            })
            cleaner.once("close", code => {
                clearTimeout(timeout)
                if (code !== 0) reject(new Error(`Windows 子进程树清理失败（${code}）`))
                else resolve(Number(output.trim()) > 0 ? "reaped" : "clean")
            })
        })
    }
}
