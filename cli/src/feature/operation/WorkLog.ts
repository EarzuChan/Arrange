import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join, relative, isAbsolute } from "node:path"
import { localWorkDirectory } from "../../CliMetadata.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { stripAnsi } from "../../util/TerminalText.ts"
import { randomUUID } from "node:crypto"

// CLI 开发时可临时开启，独立于用户应用的 debug/release 构建配置
export const recordAllTaskLogs = false

// 实际失败才落盘，正常停止与用户取消只保留会话历史
const keptRuns = 20
const logDirectoryName = "logs"

function timestamp(date: Date): string {
    const pad = (value: number, width = 2): string => String(value).padStart(width, "0")
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`
}

export class TaskLogRun {
    private directory: Promise<string> | undefined
    private readonly name = `${timestamp(new Date())}-${process.pid}-${randomUUID()}`

    // 同一次运行的所有任务共用一个目录；目录首次使用时创建并清理旧运行
    open(rootDir: string, id: string): TaskLogFile {
        return new TaskLogFile(async text => {
            const directory = await (this.directory ??= this.prepare(rootDir))
            const path = join(directory, `${id.replace(/[^A-Za-z0-9._-]/g, "-")}.log`)
            await writeFile(path, text, { flag: 'a' })
            return displayPath(path)
        })
    }

    private async prepare(rootDir: string): Promise<string> {
        const root = join(rootDir, localWorkDirectory, logDirectoryName)
        await assertPlainDirectoryPath(rootDir, root)
        const directory = join(root, this.name)
        await mkdir(directory, { recursive: true })
        const runs = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
        for (const stale of runs.slice(0, Math.max(0, runs.length - keptRuns))) {
            const pid = stale.match(/^\d{8}-\d{6}-\d{3}-(\d+)-/)?.[1]
            if (pid) {
                try {
                    process.kill(Number(pid), 0)
                    continue
                } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue }
            }
            await rm(join(root, stale), { recursive: true, force: true }).catch(() => { })
        }
        return directory
    }
}

// 相对当前目录显示，便于在终端里直接打开；不在当前目录下时显示绝对路径
export function displayPath(path: string, base: string = process.cwd()): string {
    const shown = relative(base, path)
    return shown && !shown.startsWith("..") && !isAbsolute(shown) ? shown : path
}

export class TaskLogFile {
    private readonly lines: string[] = []
    private closing?: Promise<string | undefined>

    constructor(private readonly save: (text: string) => Promise<string>) { }

    write(line: string): void {
        if (this.closing) throw new Error('任务日志已结束')
        this.lines.push(stripAnsi(line) + "\n")
    }

    close(failed: boolean): Promise<string | undefined> { return this.closing ??= this.finish(failed) }

    private async finish(failed: boolean): Promise<string | undefined> {
        try {
            if (!failed && !recordAllTaskLogs) return undefined
            return await this.save(this.lines.join(''))
        } finally { this.lines.length = 0 }
    }
}
