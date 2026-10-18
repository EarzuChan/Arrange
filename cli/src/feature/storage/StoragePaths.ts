import { lstat, readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { InspectionError } from "../../util/RecordInspection.ts"
export { nativeBuildRootKey as buildPathKey } from "../cmake/BuildOwnerRecord.ts"

export function storagePathIdentity(path: string): string { return process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path) }
export function storageId(kind: string, path: string): string { return `${kind}:${createHash("sha256").update(storagePathIdentity(path)).digest("hex").slice(0, 16)}` }
export async function directoryNames(path: string): Promise<string[]> {
    try { return await readdir(path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
    }
}
export async function assertDirectory(path: string): Promise<void> {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new InspectionError({ state: "damaged", path, reason: "资源必须为普通目录，不能为链接" })
}
export async function storageUsage(path: string, signal: AbortSignal): Promise<{ bytes: number, sizeComplete: boolean }> {
    let bytes = 0
    let sizeComplete = true
    async function visit(current: string): Promise<void> {
        signal.throwIfAborted()
        try {
            const info = await lstat(current)
            if (info.isSymbolicLink()) return
            if (info.isDirectory()) for (const name of await readdir(current)) await visit(join(current, name))
            else if (info.isFile()) bytes += info.size
        } catch {
            signal.throwIfAborted()
            sizeComplete = false
        }
    }
    await visit(path)
    return { bytes, sizeComplete }
}
