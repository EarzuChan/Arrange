import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { stringify } from "yaml"
import { ProjectStateStore, projectFileNames } from "../src/project/ProjectStateStore.ts"
import type { LocalDefinition } from "../src/project/ProjectState.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { readSnapshot } from "../src/util/FileUtils.ts"

test("saveLocal 准备好临时内容后取消不提交本机配置，保留失败记录并传递 AbortError", async t => {
    for (const existing of [false, true]) await t.test(existing ? "保留已有本机配置" : "不发布新本机配置", async t => {
        const root = await mkdtemp(resolve(tmpdir(), "arrange-store-cancel-"))
        t.after(() => rm(root, { recursive: true, force: true }))
        const projectPath = resolve(root, projectFileNames.project)
        const localPath = resolve(root, projectFileNames.local)
        const originalProject = "# 保留用户的共享配置\n"
        const originalLocal = stringify({ node: { path: "/original/node", version: "26.5.0" } })
        await writeFile(projectPath, originalProject)
        if (existing) await writeFile(localPath, originalLocal)
        const controller = new AbortController()
        Object.defineProperty(controller.signal, "throwIfAborted", {
            value() {
                if (readdirSync(root).some(name => name.startsWith(".arrange-") && name.endsWith(".tmp"))) controller.abort()
                AbortSignal.prototype.throwIfAborted.call(this)
            }
        })
        const writer = new FileTransaction(controller.signal)
        const store = new ProjectStateStore(writer)
        const proposed: LocalDefinition = { node: { path: "/proposed/node", version: "26.6.0" } }
        const guards = await Promise.all([projectPath, localPath].map(readSnapshot))
        await assert.rejects(store.saveLocal(root, proposed, guards), error => {
            assert.ok(error instanceof Error)
            assert.equal(error.name, "AbortError")
            assert.equal(error.cause, controller.signal.reason)
            assert.match(error.message, /写入已取消.*\.arrange\/transactions/)
            return true
        })
        assert.equal(await readFile(projectPath, "utf8"), originalProject)
        if (existing) assert.equal(await readFile(localPath, "utf8"), originalLocal)
        else await assert.rejects(readFile(localPath), { code: "ENOENT" })
        const journals = await readdir(resolve(root, ".arrange/transactions"))
        assert.equal(journals.length, 1)
        const inspection = await writer.inspectJournal(resolve(root, ".arrange/transactions", journals[0]))
        assert.equal(inspection.journal.status, "failed")
        assert.equal(inspection.journal.files[0].path, localPath)
        assert.equal(inspection.journal.files[0].original, existing ? originalLocal : null)
        assert.equal(inspection.journal.files[0].expected, stringify(proposed))
        assert.equal(inspection.journal.files[0].written, false)
        assert.deepEqual(inspection.states, ["original"])
        assert.ok((await readdir(root, { recursive: true })).every(name => !name.endsWith(".tmp")))
    })
})
