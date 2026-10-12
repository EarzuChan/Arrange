import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import test from "node:test"

const execute = promisify(execFile)
const runnerEnv = { ...process.env }
delete runnerEnv.NODE_TEST_CONTEXT
const reporter = pathToFileURL(resolve("scripts/platform-test-reporter.ts")).href

test("平台验收报告分别记录通过和对方平台不适用，不把排除项计为通过", async t => {
    const root = await mkdtemp(join(tmpdir(), "arrange-report-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const fixture = join(root, "report.test.mjs")
    await writeFile(fixture, 'import test from "node:test"\ntest("common", () => {})\ntest("other host", {skip: "不适用：仅对方平台实机"}, () => {})\n')
    const output = await execute(process.execPath, ["--import", import.meta.resolve("tsx"), "--test", `--test-reporter=${reporter}`, fixture], { env: runnerEnv })
    const report = JSON.parse(output.stdout)
    assert.equal(report.platform, process.platform)
    assert.equal(report.architecture, process.arch)
    assert.deepEqual(report.unverified, [])
    assert.deepEqual(report.failures, [])
    assert.equal(report.summary.counts.passed, 1)
    assert.equal(report.summary.counts.skipped, 1)
    assert.deepEqual(report.excluded, [{ name: "other host", reason: "不适用：仅对方平台实机" }])
})

test("本机未验证项让正式验收失败，不能通过跳过工具前提得到通过结论", async t => {
    const root = await mkdtemp(join(tmpdir(), "arrange-report-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const fixture = join(root, "report.test.mjs")
    await writeFile(fixture, 'import test from "node:test"\ntest("native prerequisites", {skip: "缺少工具链"}, () => {})\n')
    await assert.rejects(execute(process.execPath, ["--import", import.meta.resolve("tsx"), "--test", `--test-reporter=${reporter}`, fixture], { env: runnerEnv }), error => {
        const failure = error as Error & { code: number, stderr: string }
        assert.notEqual(failure.code, 0)
        assert.match(failure.stderr, /本机测试存在未验证项.*缺少工具链/)
        return true
    })
})
