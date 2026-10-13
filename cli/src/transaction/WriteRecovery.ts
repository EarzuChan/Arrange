import { lstat, mkdir, readFile, rm, writeFile, rename, link } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { TransactionRecord, TransactionStore } from "./TransactionStore.ts"
import { writePayloadSchema as schema } from "./WritePayload.ts"

export class WriteRecovery {
    constructor(private readonly store: TransactionStore, private readonly signal: AbortSignal) { }

    paths(record: TransactionRecord): readonly string[] { return schema.parse(record.payload).files.map(file => file.path) }

    async conflicts(record: TransactionRecord): Promise<readonly string[]> {
        const conflicts: string[] = []
        for (const file of schema.parse(record.payload).files) {
            const info = await lstat(file.path).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (info && (!info.isFile() || info.isSymbolicLink())) {
                conflicts.push(`不是普通文件：${file.path}`)
                continue
            }
            const current = info ? await readFile(file.path, "utf8") : null
            if (current !== file.original && current !== file.expected) conflicts.push(`文件已修改：${file.path}`)
        }
        return conflicts
    }

    async apply(record: TransactionRecord, rollback: boolean, finish = true): Promise<void> {
        const payload = schema.parse(record.payload)
        record.payload = payload
        record.status = "running"
        if (finish) await this.store.save(record)
        try {
            for (const file of rollback ? [...payload.files].reverse() : payload.files) {
                this.signal.throwIfAborted()
                const info = await lstat(file.path).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                    throw error
                })
                if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`恢复目标不是普通文件：${file.path}`)
                const current = info ? await readFile(file.path, "utf8") : null
                if (current !== file.original && current !== file.expected) throw new Error(`恢复冲突，文件已被修改：${file.path}`)
                const wanted = rollback ? file.original : file.expected
                if (current !== wanted) {
                    if (wanted === null) await rm(file.path)
                    else {
                        await mkdir(dirname(file.path), { recursive: true })
                        const temporary = join(dirname(file.path), `.arrange-recover-${record.id}.tmp`)
                        await rm(temporary, { force: true })
                        await writeFile(temporary, wanted, { flag: "wx", mode: info?.mode })
                        try {
                            if (current === null) {
                                await link(temporary, file.path)
                                await rm(temporary)
                            }
                            else await rename(temporary, file.path)
                        } finally { await rm(temporary, { force: true }) }
                    }
                }
                file.written = !rollback
                if (finish) await this.store.save(record)
            }
            if (finish) await this.store.finish(record)
        } catch (error) {
            record.status = "failed"
            record.error = String(error)
            if (finish) await this.store.save(record)
            throw error
        }
    }
}
