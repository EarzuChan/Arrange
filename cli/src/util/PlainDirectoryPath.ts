import { lstat, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

// 工程根允许由用户通过别名访问；CLI 自有目录的后续层级必须是真实目录
export async function assertPlainDirectoryPath(base: string, target: string): Promise<void> {
    const path = relative(resolve(base), resolve(target))
    if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error(`CLI 工作目录超出工程根：${target}`)
    let current = await realpath(base)
    for (const segment of path.split(sep).filter(Boolean)) {
        current = join(current, segment)
        try {
            const stat = await lstat(current)
            if (stat.isSymbolicLink()) throw new Error(`CLI 工作目录不能包含符号链接：${current}`)
            if (!stat.isDirectory()) throw new Error(`CLI 工作路径不是目录：${current}`)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return
            throw error
        }
    }
}
