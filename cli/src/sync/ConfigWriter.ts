import {randomUUID} from "node:crypto"
import {mkdir, readFile, rename, rm, writeFile, stat, link} from "node:fs/promises"
import {dirname, join} from "node:path"
import {assertSnapshots, readSnapshot, type FileSnapshot} from "../util/FileUtils.ts"
import {hashText} from "../util/Utils.ts"

export interface FileChange {
    readonly before: FileSnapshot,
    readonly after: string
}

export interface WriteJournal {
    readonly id: string
    status: "writing" | "complete" | "failed"
    error?: string
    readonly files: { path: string, originalHash: string | null, expectedHash: string, original: string | null, expected: string, written: boolean }[]
}

export class ConfigWriter {
    async write(rootDir: string, changes: readonly FileChange[], guards: readonly FileSnapshot[] = []): Promise<void> {
        if (!changes.length) return

        await assertSnapshots([...guards, ...changes.map(change => change.before)])

        const id = randomUUID()
        const journalPath = join(rootDir, ".arrange", "transactions", `${id}.json`)
        const journal: WriteJournal = {id, status: "writing", files: changes.map(change => ({path: change.before.path, originalHash: change.before.content === null ? null : hashText(change.before.content), expectedHash: hashText(change.after), original: change.before.content, expected: change.after, written: false}))}
        await mkdir(join(rootDir, ".arrange"), {recursive: true})

        try {
            await writeFile(join(rootDir, ".arrange", ".gitignore"), "*\n", {flag: "wx"})
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }

        await this.saveJournal(journalPath, journal)

        try {
            for (const change of changes) {
                await assertSnapshots(guards)
                await this.replaceFile(change.before, change.after, id)
                journal.files.find(file => file.path === change.before.path)!.written = true
                await this.saveJournal(journalPath, journal)
            }

            journal.status = "complete"

            await this.saveJournal(journalPath, journal)
        } catch (error) {
            journal.status = "failed"
            journal.error = error instanceof Error ? error.message : String(error)

            await this.saveJournal(journalPath, journal)

            throw new Error(`写入未完成，原文、目标内容及进度保存在 ${journalPath}：${journal.error}`, {cause: error})
        }
    }

    protected async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
        await mkdir(dirname(before.path), {recursive: true})

        const temporary = join(dirname(before.path), `.arrange-${id}.tmp`)

        try {
            const mode = before.content === null ? undefined : (await stat(before.path)).mode
            await writeFile(temporary, after, {encoding: "utf8", flag: "wx", mode})
            await assertSnapshots([before])

            if (before.content === null) await link(temporary, before.path) // 原子发布已写好的新文件；同名目标出现时 link 失败，不覆盖
            else await rename(temporary, before.path)
        } finally {
            await rm(temporary, {force: true})
        }
    }

    private async saveJournal(path: string, journal: WriteJournal): Promise<void> {
        await mkdir(dirname(path), {recursive: true})

        const temporary = `${path}.tmp`

        await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, "utf8")

        await rename(temporary, path)
    }

    async inspectJournal(path: string): Promise<{ journal: WriteJournal, states: ("original" | "expected" | "conflict")[] }> {
        const journal = JSON.parse(await readFile(path, "utf8")) as WriteJournal

        const states: ("original" | "expected" | "conflict")[] = []

        for (const file of journal.files) {
            const content = (await readSnapshot(file.path)).content
            states.push(content === file.expected ? "expected" : content === file.original ? "original" : "conflict")
        }

        return {journal, states}
    }
}
