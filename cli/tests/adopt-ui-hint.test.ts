import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { readUiSuggestions } from "../src/wizard/Adopt.ts"
import { quietTerminal } from "./fixture.ts"

async function uiDirectory(t: TestContext, withTsconfig: boolean): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "arrange-adopt-hint-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "existing-ui", version: "1.0.0" }))
    if (withTsconfig) await writeFile(join(directory, "tsconfig.json"), "{}")
    return directory
}

test("adopt 读取 UI 信息时，缺少 tsconfig.json 给出不阻塞的提示", async t => {
    const directory = await uiDirectory(t, false)
    const terminal = quietTerminal()
    const suggestions = await readUiSuggestions(directory, terminal.reporter)
    assert.match(terminal.output.text, /UI 目录没有 tsconfig\.json/)
    assert.match(terminal.output.text, /不影响 SFA 构建/)
    assert.deepEqual(suggestions, { name: "existing-ui", version: "1.0.0", frameworkVersion: undefined, packageManager: undefined })
})

test("已有 tsconfig.json 时不提示", async t => {
    const directory = await uiDirectory(t, true)
    const terminal = quietTerminal()
    await readUiSuggestions(directory, terminal.reporter)
    assert.doesNotMatch(terminal.output.text, /没有 tsconfig\.json/)
})
