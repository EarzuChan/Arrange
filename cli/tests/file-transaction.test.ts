import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { readSnapshot, type FileSnapshot } from "../src/util/FileUtils.ts"
import { readJsonFile, writeJsonFile } from "../src/util/JsonFile.ts"

async function temporaryRoot(t: TestContext): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "arrange-file-transaction-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    return root
}

test("文件替换保留权限，新文件排他发布；成功不留下日志或临时内容", async t => {
    const root = await temporaryRoot(t)
    const existing = resolve(root, "existing.txt")
    const created = resolve(root, "nested/new.txt")
    await writeFile(existing, "原文", { mode: 0o640 })
    const originalMode = (await stat(existing)).mode
    await new FileTransaction().write(root, [{ before: await readSnapshot(existing), after: "新内容" }, { before: await readSnapshot(created), after: "新文件" }])
    assert.equal(await readFile(existing, "utf8"), "新内容")
    assert.equal(await readFile(created, "utf8"), "新文件")
    assert.equal((await stat(existing)).mode, originalMode)
    assert.deepEqual(await readdir(resolve(root, ".arrange/transactions")), [])
    assert.ok((await readdir(root, { recursive: true })).every(path => !path.endsWith(".tmp")))
})

test("成功日志清理失败不把完成的文件替换报成失败", async t => {
    const root = await temporaryRoot(t)
    const path = resolve(root, "new.txt")
    class RetainedJournal extends FileTransaction {
        protected override async removeJournal(): Promise<void> { throw new Error("模拟清理失败") }
    }
    const writer = new RetainedJournal()
    await writer.write(root, [{ before: await readSnapshot(path), after: "已完成" }])
    assert.equal(await readFile(path, "utf8"), "已完成")
    const paths = await readdir(resolve(root, ".arrange/transactions"))
    const inspection = await writer.inspectJournal(resolve(root, ".arrange/transactions", paths[0]))
    assert.equal(inspection.journal.status, "complete")
    assert.deepEqual(inspection.states, ["expected"])
})

test("多文件失败保留原文、目标和进度，移除无消费者的 hash 字段", async t => {
    const root = await temporaryRoot(t)
    const paths = [resolve(root, "first.txt"), resolve(root, "second.txt")]
    for (const path of paths) await writeFile(path, "原文")
    class FailingWriter extends FileTransaction {
        calls = 0
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            if (++this.calls === 2) throw new Error("模拟第二文件失败")
            await super.replaceFile(before, after, id)
        }
    }
    const changes = await Promise.all(paths.map(async path => ({ before: await readSnapshot(path), after: "目标" })))
    const writer = new FailingWriter()
    await assert.rejects(writer.write(root, changes), /原文、目标内容及进度.*第二文件失败/)
    const names = await readdir(resolve(root, ".arrange/transactions"))
    assert.equal(names.length, 1)
    const journalPath = resolve(root, ".arrange/transactions", names[0])
    const inspection = await writer.inspectJournal(journalPath)
    assert.equal(inspection.journal.status, "failed")
    assert.deepEqual(inspection.journal.files.map(file => file.written), [true, false])
    for (const file of inspection.journal.files) {
        assert.equal(file.original, "原文")
        assert.equal(file.expected, "目标")
        assert.ok(!("originalHash" in file))
        assert.ok(!("expectedHash" in file))
    }
    assert.deepEqual(inspection.states, ["expected", "original"])
    await writeFile(paths[1], "外部编辑")
    assert.deepEqual((await writer.inspectJournal(journalPath)).states, ["expected", "conflict"])
})

test("每次写入前重新核对保护快照，外部修改后保留尚未写入文件", async t => {
    const root = await temporaryRoot(t)
    const guardPath = resolve(root, "config.yaml")
    const first = resolve(root, "first.txt")
    const second = resolve(root, "second.txt")
    await writeFile(guardPath, "原配置")
    class ChangedGuardWriter extends FileTransaction {
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            await super.replaceFile(before, after, id)
            await writeFile(guardPath, "用户的新配置")
        }
    }
    await assert.rejects(new ChangedGuardWriter().write(root, [{ before: await readSnapshot(first), after: "首文件" }, { before: await readSnapshot(second), after: "次文件" }], [await readSnapshot(guardPath)]), /扫描后发生变化/)
    assert.equal(await readFile(first, "utf8"), "首文件")
    await assert.rejects(readFile(second), { code: "ENOENT" })
    assert.equal(await readFile(guardPath, "utf8"), "用户的新配置")
})

test("扫描后出现的新文件拒绝覆盖，失败日志原文仍记录原先不存在", async t => {
    const root = await temporaryRoot(t)
    const path = resolve(root, "new.txt")
    class ConcurrentWriter extends FileTransaction {
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            await writeFile(before.path, "别人刚创建的文件")
            await super.replaceFile(before, after, id)
        }
    }
    const writer = new ConcurrentWriter()
    await assert.rejects(writer.write(root, [{ before: await readSnapshot(path), after: "不能覆盖" }]), /扫描后发生变化/)
    assert.equal(await readFile(path, "utf8"), "别人刚创建的文件")
    const names = await readdir(resolve(root, ".arrange/transactions"))
    const inspection = await writer.inspectJournal(resolve(root, ".arrange/transactions", names[0]))
    assert.equal(inspection.journal.files[0].original, null)
    assert.deepEqual(inspection.states, ["conflict"])
    assert.ok((await readdir(root, { recursive: true })).every(name => !name.endsWith(".tmp")))
})

test("JSON 单文件发布失败保留旧目标并清理临时文件", async t => {
    const root = await temporaryRoot(t)
    const path = resolve(root, "record.json")
    await writeJsonFile(path, { status: "original" })
    assert.deepEqual(await readJsonFile(path), { status: "original" })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await assert.rejects(writeJsonFile(path, circular), /circular/i)
    assert.deepEqual(await readJsonFile(path), { status: "original" })
    assert.deepEqual(await readdir(root), ["record.json"])
})

test("开始前取消无目录或日志副作用，保留原 AbortError", async t => {
    const root = await temporaryRoot(t)
    const path = resolve(root, "new.txt")
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(new FileTransaction(controller.signal).write(root, [{ before: await readSnapshot(path), after: "不能写入" }]), error => error === controller.signal.reason)
    assert.deepEqual(await readdir(root), [])
})

test("首文件发布后取消停止后续写入，保留失败日志和已完成进度", async t => {
    const root = await temporaryRoot(t)
    const first = resolve(root, "first.txt")
    const second = resolve(root, "second.txt")
    const controller = new AbortController()
    class CancelledWriter extends FileTransaction {
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            await super.replaceFile(before, after, id)
            controller.abort()
        }
    }
    const writer = new CancelledWriter(controller.signal)
    await assert.rejects(writer.write(root, [{ before: await readSnapshot(first), after: "已完成首文件" }, { before: await readSnapshot(second), after: "不能写入次文件" }]), error => error instanceof Error && error.name === "AbortError" && error.cause === controller.signal.reason && error.message.includes(resolve(root, ".arrange/transactions")))
    assert.equal(await readFile(first, "utf8"), "已完成首文件")
    await assert.rejects(readFile(second), { code: "ENOENT" })
    const names = await readdir(resolve(root, ".arrange/transactions"))
    const inspection = await writer.inspectJournal(resolve(root, ".arrange/transactions", names[0]))
    assert.equal(inspection.journal.status, "failed")
    assert.deepEqual(inspection.journal.files.map(file => file.written), [true, false])
    assert.deepEqual(inspection.states, ["expected", "original"])
})

test("临时内容准备完毕时取消不发布，保留原文件且清理临时文件", async t => {
    const root = await temporaryRoot(t)
    const path = resolve(root, "existing.txt")
    await writeFile(path, "保留原文")
    const controller = new AbortController()
    Object.defineProperty(controller.signal, "throwIfAborted", {
        value() {
            if (readdirSync(root).some(name => name.startsWith(".arrange-") && name.endsWith(".tmp"))) controller.abort()
            AbortSignal.prototype.throwIfAborted.call(this)
        }
    })
    const writer = new FileTransaction(controller.signal)
    await assert.rejects(writer.write(root, [{ before: await readSnapshot(path), after: "不能发布" }]), error => error instanceof Error && error.name === "AbortError" && error.cause === controller.signal.reason && error.message.includes(resolve(root, ".arrange/transactions")))
    assert.equal(await readFile(path, "utf8"), "保留原文")
    const names = await readdir(resolve(root, ".arrange/transactions"))
    const inspection = await writer.inspectJournal(resolve(root, ".arrange/transactions", names[0]))
    assert.equal(inspection.journal.status, "failed")
    assert.equal(inspection.journal.files[0].written, false)
    assert.deepEqual(inspection.states, ["original"])
    assert.ok((await readdir(root, { recursive: true })).every(name => !name.endsWith(".tmp")))
})
