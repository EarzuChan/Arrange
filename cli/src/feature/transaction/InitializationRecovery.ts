import { lstat, mkdir, readdir, readFile, readlink, rm, rmdir, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import { createHash } from "node:crypto"
import type { TransactionRecord, TransactionStore } from "./TransactionStore.ts"
import { assertOwnedPath, fileContentIdentity } from "./TreeState.ts"
import { WriteRecovery } from "./WriteRecovery.ts"
import { writeFileSchema } from "./WritePayload.ts"

const itemSchema = z.object({ path: z.string(), source: z.string().optional(), bytes: z.string().optional(), kind: z.enum(["file", "directory", "link"]), identity: z.string(), link: z.string().optional() })
const schema = z.object({ items: z.array(itemSchema), files: z.array(writeFileSchema) }).passthrough()
type Item = z.infer<typeof itemSchema>
const bytesIdentity = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex")

export async function initializationItems(copies: readonly { source: string, destination: string }[], icons: readonly { kind: string, source: string, destination: string, bytes?: Buffer }[], excluded: ReadonlySet<string>): Promise<Item[]> {
    const result: Item[] = []
    async function visit(source: string, path: string): Promise<void> {
        const info = await lstat(source)
        if (info.isSymbolicLink()) {
            const link = await readlink(source)
            result.push({ path, source, kind: "link", identity: link, link })
        } else if (info.isDirectory()) {
            result.push({ path, source, kind: "directory", identity: "directory" })
            for (const name of await readdir(source)) if (!excluded.has(name)) await visit(join(source, name), join(path, name))
        } else if (info.isFile()) result.push({ path, source, kind: "file", identity: await fileContentIdentity(source) })
        else throw new Error(`复制源含不支持的文件类型：${source}`)
    }
    for (const copy of copies) await visit(copy.source, copy.destination)
    for (const icon of icons) if (icon.kind === "copy") {
        const bytes = icon.bytes ?? await readFile(icon.source)
        result.push({ path: icon.destination, bytes: bytes.toString("base64"), kind: "file", identity: bytesIdentity(bytes) })
    }
    return result
}

export class InitializationRecovery {
    constructor(private readonly store: TransactionStore, private readonly signal: AbortSignal) { }

    paths(record: TransactionRecord): readonly string[] {
        const payload = schema.parse(record.payload)
        return [...payload.files.map(file => file.path), ...payload.items.map(item => item.path)]
    }

    async conflicts(record: TransactionRecord): Promise<readonly string[]> {
        const payload = schema.parse(record.payload)
        const conflicts = [...await new WriteRecovery(this.store, this.signal).conflicts(record)]
        for (const item of payload.items) {
            const info = await lstat(item.path).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (!info) continue
            const current = item.kind === "directory" && info.isDirectory() ? "directory" : item.kind === "link" && info.isSymbolicLink() ? await readlink(item.path) : item.kind === "file" && info.isFile() ? await fileContentIdentity(item.path) : "conflict"
            if (current !== item.identity) conflicts.push(`初始化内容已修改：${item.path}`)
        }
        return conflicts
    }

    async apply(record: TransactionRecord, rollback: boolean): Promise<void> {
        const payload = schema.parse(record.payload)
        record.payload = payload
        try {
            if (rollback) {
                // 文件写入先回退；父事务统一收尾，不产生第二份恢复记录
                const child = { ...record, payload: { files: payload.files } }
                await new WriteRecovery(this.store, this.signal).apply(child, true, false)
            }
            for (const item of rollback ? [...payload.items].reverse() : payload.items) {
                this.signal.throwIfAborted()
                const info = await lstat(item.path).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                    throw error
                })
                if (item.kind !== "link") await assertOwnedPath(record.root, item.path)
                const current = !info ? null : item.kind === "directory" && info.isDirectory() ? "directory" : item.kind === "link" && info.isSymbolicLink() ? await readlink(item.path) : item.kind === "file" && info.isFile() ? await fileContentIdentity(item.path) : "conflict"
                if (current !== null && current !== item.identity) throw new Error(`初始化恢复冲突，保留用户内容：${item.path}`)
                if (rollback) {
                    if (current === null) continue
                    if (item.kind === "directory") await rmdir(item.path).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error })
                    else await rm(item.path)
                } else if (current === null) {
                    await mkdir(dirname(item.path), { recursive: true })
                    if (item.kind === "directory") await mkdir(item.path)
                    else if (item.kind === "link") await symlink(item.link!, item.path)
                    else {
                        const bytes = item.bytes ? Buffer.from(item.bytes, "base64") : await readFile(item.source!)
                        if (bytesIdentity(bytes) !== item.identity) throw new Error(`初始化复制源已变化：${item.source}`)
                        await writeFile(item.path, bytes, { flag: "wx" })
                    }
                }
            }
            if (!rollback) await new WriteRecovery(this.store, this.signal).apply({ ...record, payload: { files: payload.files } }, false, false)
            await this.store.finish(record)
        } catch (error) {
            record.status = "failed"
            record.error = String(error)
            await this.store.save(record)
            throw error
        }
    }
}
