import { access, readdir, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"

export function environmentValue(env: Record<string, string | undefined>, key: string): string | undefined {
    const actual = Object.keys(env).find(candidate => candidate.toLowerCase() === key.toLowerCase())
    return actual ? env[actual] : undefined
}

// Windows 文件名不分大小写，PATHEXT 里的大写扩展名（.CMD）会拼出与磁盘不同的写法；只读目录项还原真实文件名，不解析符号链接
async function onDiskName(candidate: string): Promise<string> {
    try {
        const name = basename(candidate)
        const actual = (await readdir(dirname(candidate))).find(entry => entry.toLowerCase() === name.toLowerCase())
        return actual ? join(dirname(candidate), actual) : candidate
    } catch { return candidate }
}

export async function locateTool(command: string, env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
    const paths = isAbsolute(command) || /[\\/]/.test(command) ? [resolve(command)] : (environmentValue(env, "PATH") ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ""), command))
    // Windows 只执行带可执行扩展名的文件：无扩展名的命令按 PATHEXT 顺序解析，不尝试同目录下无扩展名的 sh 垫片（如 npm、pnpm）
    const suffixes = platform === "win32" && !/\.[A-Za-z0-9]+$/.test(command) ? (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""]
    for (const path of paths) for (const suffix of suffixes) {
        const candidate = `${path}${suffix}`
        try {
            if (!(await stat(candidate)).isFile()) continue
            await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK)
            return suffix && platform === "win32" ? await onDiskName(candidate) : candidate
        } catch { }
    }
    return undefined
}
