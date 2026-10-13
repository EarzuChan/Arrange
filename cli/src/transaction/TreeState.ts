import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readlink, readdir } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"

export function containsPath(root: string, path: string): boolean {
    const part = relative(resolve(root), resolve(path))
    return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
}

export async function assertOwnedPath(root: string, path: string): Promise<void> {
    if (resolve(root) === resolve(path) || !containsPath(root, path)) throw new Error(`事务目标不能覆盖归属根或越界：${path}`)
    await assertPlainDirectoryPath(root, dirname(path))
    const info = await lstat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw error
    })
    if (info?.isSymbolicLink()) throw new Error(`事务目标不能为符号链接：${path}`)
}

export async function treeIdentity(path: string): Promise<string | null> {
    const initial = await lstat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw error
    })
    if (!initial) return null
    const hash = createHash("sha256")
    async function visit(current: string, name: string): Promise<void> {
        const info = await lstat(current)
        hash.update(JSON.stringify([name, info.isSymbolicLink() ? "link" : info.isDirectory() ? "directory" : "file", info.mode & 0o777]))
        if (info.isSymbolicLink()) hash.update(await readlink(current))
        else if (info.isDirectory()) for (const entry of (await readdir(current)).sort()) await visit(join(current, entry), `${name}/${entry}`)
        else if (info.isFile()) for await (const chunk of createReadStream(current)) hash.update(chunk)
        else throw new Error(`不支持的事务文件类型：${current}`)
    }
    await visit(path, "")
    return hash.digest("hex")
}

export async function fileContentIdentity(path: string): Promise<string> {
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest("hex")
}
