import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { z } from "zod"
import { transactionSchema } from "../../CliMetadata.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { canonicalResource } from "../operation/Resource.ts"

const schema = z.object({ schema: z.literal(transactionSchema), id: z.string().uuid(), kind: z.enum(["write", "initialize", "replace", "delete"]), root: z.string(), status: z.enum(["pending", "running", "failed", "complete"]), created: z.string(), error: z.string().optional(), payload: z.unknown() })
export type TransactionRecord = z.infer<typeof schema>

export class TransactionStore {
    constructor(readonly root: string, readonly directory = join(root, ".arrange", "transactions")) { }

    async create(kind: TransactionRecord["kind"], payload: unknown): Promise<TransactionRecord> {
        const record: TransactionRecord = { schema: transactionSchema, id: randomUUID(), kind, root: resolve(this.root), status: "pending", created: new Date().toISOString(), payload }
        await this.save(record)
        return record
    }

    path(id: string): string {
        z.string().uuid().parse(id)
        return join(this.directory, id, "record.json")
    }

    async save(record: TransactionRecord): Promise<void> {
        schema.parse(record)
        if (!await this.sameRoot(record.root)) throw new Error("事务根不匹配")
        await assertPlainDirectoryPath(this.root, this.directory)
        const path = this.path(record.id)
        await mkdir(join(this.directory, record.id), { recursive: true })
        await assertPlainDirectoryPath(this.root, join(this.directory, record.id))
        await writeAtomicText(path, `${JSON.stringify(record, null, 4)}\n`)
    }

    async read(id: string): Promise<TransactionRecord> {
        const path = this.path(id)
        await assertPlainDirectoryPath(this.root, join(this.directory, id))
        if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error("事务记录必须为普通文件")
        const record = schema.parse(JSON.parse(await readFile(path, "utf8")))
        if (record.id !== id || !await this.sameRoot(record.root)) throw new Error("事务身份不匹配")
        return record
    }

    private async sameRoot(root: string): Promise<boolean> {
        const first = await canonicalResource({ kind: "configuration", path: root, mode: "read" })
        const second = await canonicalResource({ kind: "configuration", path: this.root, mode: "read" })
        return first.path === second.path
    }

    async list(): Promise<readonly { id: string, record?: TransactionRecord, error?: string }[]> {
        const names = await readdir(this.directory).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
            throw error
        })
        await assertPlainDirectoryPath(this.root, this.directory).catch(error => { if (names.length) throw error })
        return Promise.all(names.map(async id => {
            try { return { id, record: await this.read(id) } } catch (error) { return { id, error: `记录损坏或旧格式，需人工检查：${String(error)}` } }
        }))
    }

    async finish(record: TransactionRecord): Promise<void> {
        record.status = "complete"
        await this.save(record)
        await this.remove(record.id)
    }

    async remove(id: string): Promise<void> {
        await assertPlainDirectoryPath(this.root, join(this.directory, id))
        await rm(join(this.directory, id), { recursive: true })
    }
}
