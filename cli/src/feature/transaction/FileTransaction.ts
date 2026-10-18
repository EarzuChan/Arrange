import { localWorkDirectory } from "../../CliMetadata.ts"
import { mkdir, readFile, rename, rm, writeFile, stat, link } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { assertSnapshots, readSnapshot, type FileSnapshot } from "../../util/FileUtils.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { TransactionStore, type TransactionRecord } from "./TransactionStore.ts"
import { writePayloadSchema, type WritePayload } from "./WritePayload.ts"

export interface FileChange {
    readonly before: FileSnapshot,
    readonly after: string
}

export class FileTransaction {
    constructor(private readonly defaultSignal?: AbortSignal) { }

    async write(rootDir: string, changes: readonly FileChange[], guards: readonly FileSnapshot[] = [], existing?: TransactionRecord): Promise<void> {
        this.defaultSignal?.throwIfAborted()
        if (!changes.length) return

        await assertSnapshots([...guards, ...changes.map(change => change.before)])
        this.defaultSignal?.throwIfAborted()

        const store = new TransactionStore(rootDir)
        const record = existing ?? await store.create("write", { files: changes.map(change => ({ path: change.before.path, original: change.before.content, expected: change.after, written: false })) })
        const id = record.id
        const journalPath = store.path(id)
        const payload = record.payload as WritePayload
        await assertPlainDirectoryPath(rootDir, dirname(journalPath))
        await mkdir(join(rootDir, localWorkDirectory), { recursive: true })

        try {
            await writeFile(join(rootDir, localWorkDirectory, ".gitignore"), "*\n", { flag: "wx" })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }

        record.status = "running"
        await store.save(record)

        try {
            for (const change of changes) {
                this.defaultSignal?.throwIfAborted()
                await assertSnapshots(guards)
                await this.replaceFile(change.before, change.after, id)
                payload.files.find(file => file.path === change.before.path)!.written = true
                await store.save(record)
            }
        } catch (error) {
            record.status = "failed"
            record.error = error instanceof Error ? error.message : String(error)

            if ((this.defaultSignal?.aborted && error === this.defaultSignal.reason) || (error instanceof Error && error.name === "AbortError")) {
                await store.save(record).catch(() => { })
                const cancelled = new Error(`写入已取消，原文、目标内容及进度保存在 ${journalPath}：${record.error}`, { cause: error })
                cancelled.name = "AbortError"
                throw cancelled
            }
            await store.save(record)

            throw new Error(`写入未完成，原文、目标内容及进度保存在 ${journalPath}：${record.error}`, { cause: error })
        }

        if (existing) return
        record.status = "complete"
        await store.save(record)
        try {
            await this.removeJournal(journalPath)
        } catch {
            await store.save(record).catch(() => { })
        }
    }

    protected async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
        this.defaultSignal?.throwIfAborted()
        await mkdir(dirname(before.path), { recursive: true })

        const temporary = join(dirname(before.path), `.arrange-${id}.tmp`)

        try {
            const mode = before.content === null ? undefined : (await stat(before.path)).mode
            await writeFile(temporary, after, { encoding: "utf8", flag: "wx", mode })
            await assertSnapshots([before])
            this.defaultSignal?.throwIfAborted()

            if (before.content === null) await link(temporary, before.path) // 原子发布已写好的新文件；同名目标出现时 link 失败，不覆盖
            else await rename(temporary, before.path)
        } finally {
            await rm(temporary, { force: true }).catch(() => { })
        }
    }

    protected async removeJournal(path: string): Promise<void> {
        await rm(dirname(path), { recursive: true })
    }

    async inspectTransaction(directory: string): Promise<{ record: TransactionRecord, files: WritePayload["files"], states: ("original" | "expected" | "conflict")[] }> {
        const root = dirname(dirname(dirname(directory)))
        const record = await new TransactionStore(root).read(basename(directory))
        const payload = writePayloadSchema.parse(record.payload)

        const states: ("original" | "expected" | "conflict")[] = []

        for (const file of payload.files) {
            const content = (await readSnapshot(file.path)).content
            states.push(content === file.expected ? "expected" : content === file.original ? "original" : "conflict")
        }

        return { record, files: payload.files, states }
    }
}
