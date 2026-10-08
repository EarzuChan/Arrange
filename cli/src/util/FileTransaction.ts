import { localWorkDirectory } from "../CliMetadata.ts"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile, stat, link } from "node:fs/promises"
import { dirname, join } from "node:path"
import { assertSnapshots, readSnapshot, type FileSnapshot } from "./FileUtils.ts"
import { assertPlainDirectoryPath } from "./PlainDirectoryPath.ts"
import { writeJsonFile } from "./JsonFile.ts"

export interface FileChange {
    readonly before: FileSnapshot,
    readonly after: string
}

export interface WriteJournal {
    readonly id: string
    status: "writing" | "complete" | "failed"
    error?: string
    readonly files: { path: string, original: string | null, expected: string, written: boolean }[]
}

export class FileTransaction {
    constructor(private readonly defaultSignal?: AbortSignal) { }

    async write(rootDir: string, changes: readonly FileChange[], guards: readonly FileSnapshot[] = []): Promise<void> {
        this.defaultSignal?.throwIfAborted()
        if (!changes.length) return

        await assertSnapshots([...guards, ...changes.map(change => change.before)])
        this.defaultSignal?.throwIfAborted()

        const id = randomUUID()
        const journalPath = join(rootDir, localWorkDirectory, "transactions", `${id}.json`)
        const journal: WriteJournal = { id, status: "writing", files: changes.map(change => ({ path: change.before.path, original: change.before.content, expected: change.after, written: false })) }
        await assertPlainDirectoryPath(rootDir, dirname(journalPath))
        await mkdir(join(rootDir, localWorkDirectory), { recursive: true })

        try {
            await writeFile(join(rootDir, localWorkDirectory, ".gitignore"), "*\n", { flag: "wx" })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }

        await writeJsonFile(journalPath, journal)

        try {
            for (const change of changes) {
                this.defaultSignal?.throwIfAborted()
                await assertSnapshots(guards)
                await this.replaceFile(change.before, change.after, id)
                journal.files.find(file => file.path === change.before.path)!.written = true
                await writeJsonFile(journalPath, journal)
            }
        } catch (error) {
            journal.status = "failed"
            journal.error = error instanceof Error ? error.message : String(error)

            if ((this.defaultSignal?.aborted && error === this.defaultSignal.reason) || (error instanceof Error && error.name === "AbortError")) {
                await writeJsonFile(journalPath, journal).catch(() => { })
                const cancelled = new Error(`写入已取消，原文、目标内容及进度保存在 ${journalPath}：${journal.error}`, { cause: error })
                cancelled.name = "AbortError"
                throw cancelled
            }
            await writeJsonFile(journalPath, journal)

            throw new Error(`写入未完成，原文、目标内容及进度保存在 ${journalPath}：${journal.error}`, { cause: error })
        }

        journal.status = "complete"
        try {
            await this.removeJournal(journalPath)
        } catch {
            await writeJsonFile(journalPath, journal).catch(() => { })
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
        await rm(path, { force: true })
    }

    async inspectJournal(path: string): Promise<{ journal: WriteJournal, states: ("original" | "expected" | "conflict")[] }> {
        const journal = JSON.parse(await readFile(path, "utf8")) as WriteJournal

        const states: ("original" | "expected" | "conflict")[] = []

        for (const file of journal.files) {
            const content = (await readSnapshot(file.path)).content
            states.push(content === file.expected ? "expected" : content === file.original ? "original" : "conflict")
        }

        return { journal, states }
    }
}
