import assert from "node:assert/strict"
import { test } from "node:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { createServer } from "node:http"
import { once } from "node:events"
import { join } from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { assertCliEnvironment } from "../src/util/CliEnvironment.ts"
import { createCliApplication, type CliInteractions } from "../src/CliApplication.ts"
import { createPlatformService } from "../src/feature/platform/CreatePlatformService.ts"
import { Executor } from "../src/feature/platform/Executor.ts"
import { ProjectStateStore } from "../src/feature/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/feature/transaction/FileTransaction.ts"
import { cmakeListsFile } from "../src/feature/cmake/CmakeStuffs.ts"
import { cliCompatibility } from "../src/CliMetadata.ts"
import { fixture, quietTerminal, TestSyncWizard } from "./fixture.ts"
import { UserDirectories } from "../src/feature/user/UserDirectories.ts"

const exec = promisify(execFile)
const sourceEntry = fileURLToPath(new URL("../src/Entry.ts", import.meta.url))
const tsxLoader = import.meta.resolve("tsx")
const ask = async (): Promise<never> => { throw new Error("测试未授权交互") }
const noop = (): void => { }

function interactions(config = new TestSyncWizard()): CliInteractions {
    return {
        config,
        project: { create: ask, adopt: ask, confirm: ask, confirmInitialization: ask, message: noop, failure: noop },
        setup: { report: noop, acceptTools: ask, editTools: ask, message: noop, failure: noop }
    }
}

test("入口总闸门要求支持的平台和双 TTY", () => {
    for (const platform of ["darwin", "win32"] as const) {
        assert.doesNotThrow(() => assertCliEnvironment({ platform, stdinIsTTY: true, stdoutIsTTY: true }))
        for (const [stdinIsTTY, stdoutIsTTY] of [[false, false], [true, false], [false, true]]) assert.throws(() => assertCliEnvironment({ platform, stdinIsTTY: stdinIsTTY!, stdoutIsTTY: stdoutIsTTY! }), /stdin 和 stdout.*TTY/)
    }
    for (const platform of ["linux", "freebsd"] as const) {
        assert.throws(() => assertCliEnvironment({ platform, stdinIsTTY: true, stdoutIsTTY: true }), /只支持 Windows 和 macOS/)
        assert.throws(() => createPlatformService(new Executor(platform), platform), /只支持 Windows 和 macOS/)
    }
})

test("正式入口包括 help/version 都拒绝非 TTY，且不读取工程或访问 registry", async t => {
    const state = await fixture(t)
    let requests = 0
    const server = createServer((_request, response) => {
        requests++
        response.end("{}")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    state.project.framework.nodeRegistryUrl = `http://127.0.0.1:${address.port}`
    await new ProjectStateStore(new FileTransaction()).save(state)
    const before = await readFile(cmakeListsFile.path(state), "utf8")
    for (const args of [["--help"], ["--version"], ["sync", "--config"], ["create"]]) {
        await assert.rejects(exec(process.execPath, ["--import", tsxLoader, sourceEntry, ...args], { cwd: state.rootDir, env: { ...process.env, NODE_ENV: "test", NODE_NO_WARNINGS: "1" }, timeout: 15000 }), error => {
            const failure = error as Error & { code: number, stdout: string }
            assert.equal(failure.code, 1)
            assert.match(failure.stdout, /stdin 和 stdout.*TTY/)
            return true
        })
    }
    assert.equal(requests, 0)
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), before)
    await assert.rejects(readdir(join(state.rootDir, ".arrange")), { code: "ENOENT" })
})

test("程序化装配显式接受交互策略，不自启动或注册全局信号监听器", async () => {
    const listeners = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]
    const cli = createCliApplication({ signal: new AbortController().signal, interactions: interactions(), terminal: quietTerminal() })
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], listeners)
    let output = ""
    cli.configureOutput({ writeOut: value => { output += value } }).exitOverride()
    await assert.rejects(cli.parseAsync(["node", "arrange", "--version"]), error => (error as { code?: string }).code === "commander.version")
    assert.ok(output.trim())
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], listeners)
})

test('子命令帮助和参数错误通过应用退出策略返回，完整历史由调用方拍扁', async () => {
    const runner = fileURLToPath(new URL('./cli-runner.ts', import.meta.url))
    const help = await exec(process.execPath, ['--import', tsxLoader, runner, 'help', 'sync'])
    assert.match(help.stdout, /--setup/)
    assert.match(help.stdout, /--native/)
    assert.ok(help.stdout.startsWith('\n'))
    await assert.rejects(exec(process.execPath, ['--import', tsxLoader, runner, 'sync', '--does-not-exist']), error => {
        const failure = error as Error & { code: number, stdout: string }
        assert.equal(failure.code, 1)
        assert.match(failure.stdout, /unknown option/)
        return true
    })
})

test("registry 请求期间取消 CONFIG，不报告完成或发布文件", async t => {
    const state = await fixture(t)
    state.project.project.version = "2.0.0"
    const controller = new AbortController()
    let requests = 0
    const server = createServer((_request, response) => {
        requests++
        controller.abort()
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({ version: state.project.framework.version, arrange: { cliCompatibility } }))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    state.project.framework.nodeRegistryUrl = `http://127.0.0.1:${address.port}`
    await new ProjectStateStore(new FileTransaction()).save(state)
    const before = await readFile(cmakeListsFile.path(state), "utf8")
    const config = new TestSyncWizard()
    const cli = createCliApplication({ signal: controller.signal, interactions: interactions(config), terminal: quietTerminal(), userDirectories: new UserDirectories(join(state.rootDir, "test-user")) }).exitOverride()
    const cwd = process.cwd()
    process.chdir(state.rootDir)
    try {
        await assert.rejects(cli.parseAsync(["node", "arrange", "sync", "--config"]), error => error === controller.signal.reason)
    } finally { process.chdir(cwd) }
    assert.equal(requests, 1)
    assert.deepEqual(config.messages, [])
    assert.deepEqual(config.failures, [])
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), before)
    await assert.rejects(readdir(join(state.rootDir, ".arrange")), { code: "ENOENT" })
})
