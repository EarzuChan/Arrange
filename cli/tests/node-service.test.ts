import assert from "node:assert/strict"
import { readFile, rm, symlink } from "node:fs/promises"
import { resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { cliCompatibility, frameworkPackageName, uiPreparationFileName } from "../src/CliMetadata.ts"
import { UiBuildService } from "../src/building/UiBuildService.ts"
import { packageJsonFile } from "../src/node-js/NodeJsStuffs.ts"
import { NodeJsService } from "../src/node-js/NodeJsService.ts"
import { Executor } from "../src/platform/Executor.ts"
import type { ProcessResult, ProcessSpec } from "../src/platform/ProcessSpec.ts"
import { fixture, write } from "./fixture.ts"

class InstallingExecutor extends Executor {
    readonly calls: ProcessSpec[] = []
    handler: (spec: ProcessSpec) => Promise<void> = async () => { }
    exitCode = 0
    cancelled = false
    override async run(spec: ProcessSpec): Promise<ProcessResult> {
        this.calls.push(spec)
        await this.handler(spec)
        return { exitCode: this.exitCode, stdout: "", stderr: "", cancelled: this.cancelled, timedOut: false }
    }
}

async function setup(t: TestContext) {
    const state = await fixture(t)
    state.local = { node: { path: "/tools/node" }, packageManager: { path: "/tools/npm" } }
    const uiRoot = resolve(state.rootDir, state.project.ui.directory)
    const executor = new InstallingExecutor()
    executor.handler = async spec => {
        if (spec.args[0] === "install") {
            const manifest = JSON.parse(await readFile(resolve(uiRoot, "package.json"), "utf8"))
            for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) await write(resolve(uiRoot, "node_modules", name, "package.json"), JSON.stringify({ name, version: name === frameworkPackageName ? state.project.framework.version : "1.0.0", arrange: name === frameworkPackageName ? { cliCompatibility } : undefined }))
        } else if (spec.args.join(" ") === "run build") await write(resolve(uiRoot, state.project.ui.outputDirectory ?? "dist", "app.js"), "export default {}\n")
    }
    return { state, uiRoot, executor, node: new NodeJsService(executor) }
}

test("UI 从未安装与缺失准备记录可重新 SETUP，成功安装后才 ready", async t => {
    const input = await setup(t)
    const initial = await input.node.inspect(input.state)
    assert.equal(initial.ready, false)
    assert.notEqual(initial.fatal, true)
    assert.equal(input.executor.calls.length, 0)
    await input.node.install(input.state)
    assert.deepEqual(await input.node.inspect(input.state), { ready: true })
    assert.equal(input.executor.calls[0].cwd, input.uiRoot)
    assert.deepEqual(input.executor.calls[0].args, ["install"])
    await rm(resolve(input.state.rootDir, ".arrange", uiPreparationFileName))
    const missing = await input.node.inspect(input.state)
    assert.equal(missing.ready, false)
    assert.notEqual(missing.fatal, true)
    await input.node.install(input.state)
    assert.equal((await input.node.inspect(input.state)).ready, true)
})

test("删除单个普通或 scoped 依赖后准备状态失效并可重新安装", async t => {
    const input = await setup(t)
    await input.node.install(input.state)
    for (const name of ["vite", "@types/node"]) {
        await rm(resolve(input.uiRoot, "node_modules", name), { recursive: true })
        const missing = await input.node.inspect(input.state)
        assert.equal(missing.ready, false)
        assert.notEqual(missing.fatal, true)
        assert.match(missing.reason!, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        await input.node.install(input.state)
        assert.equal((await input.node.inspect(input.state)).ready, true)
    }
})

test("包清单或 lock 改动使安装输入失效，失败重装不保留旧 receipt", async t => {
    const input = await setup(t)
    await input.node.install(input.state)
    await write(resolve(input.uiRoot, "package-lock.json"), '{"lockfileVersion":3}\n')
    assert.equal((await input.node.inspect(input.state)).ready, false)
    await input.node.install(input.state)
    const manifest = JSON.parse(packageJsonFile.make(input.state))
    manifest.devDependencies.extra = "1.0.0"
    await write(resolve(input.uiRoot, "package.json"), JSON.stringify(manifest))
    assert.equal((await input.node.inspect(input.state)).ready, false)
    input.executor.exitCode = 1
    await assert.rejects(input.node.install(input.state), /安装失败/)
    await assert.rejects(readFile(resolve(input.state.rootDir, ".arrange", uiPreparationFileName)), { code: "ENOENT" })
    assert.equal((await input.node.inspect(input.state)).ready, false)
})

test("UI --clean 只删除输出；源码、scripts、依赖子树及目录链链接受保护", async t => {
    const input = await setup(t)
    await input.node.install(input.state)
    const userFile = resolve(input.state.rootDir, "outside/user.txt")
    await write(userFile, "外部内容")
    for (const output of ["src/views", "scripts/generated", "node_modules/.cache", "custom/src/views", "../outside"]) {
        input.state.project.ui.outputDirectory = output
        const result = await input.node.inspect(input.state)
        assert.equal(result.ready, false)
        assert.equal(result.fatal, true)
        await assert.rejects(input.node.build(input.state, true), /UI .*目录/)
    }
    const symlinkPath = resolve(input.uiRoot, "redirect")
    await symlink(resolve(input.state.rootDir, "outside"), symlinkPath, "dir")
    input.state.project.ui.outputDirectory = "redirect/dist"
    await assert.rejects(input.node.build(input.state, true), /符号链接|非目录/)
    assert.equal(await readFile(userFile, "utf8"), "外部内容")
    assert.equal(input.executor.calls.length, 1)
    await rm(symlinkPath)
    input.state.project.ui.outputDirectory = "dist"
    await write(resolve(input.uiRoot, "dist/assets/stale.js"), "旧资源")
    await write(resolve(input.uiRoot, "src/user.ts"), "用户源码")
    assert.equal(await input.node.build(input.state, true), resolve(input.uiRoot, "dist"))
    await assert.rejects(readFile(resolve(input.uiRoot, "dist/assets/stale.js")), { code: "ENOENT" })
    assert.equal(await readFile(resolve(input.uiRoot, "src/user.ts"), "utf8"), "用户源码")
    assert.equal(await readFile(userFile, "utf8"), "外部内容")
})

test("无 dev/build 的 UI manifest 为 Fatal；命令成功但缺 app.js 仍构建失败", async t => {
    const input = await setup(t)
    await write(resolve(input.uiRoot, "package.json"), JSON.stringify({ dependencies: { [frameworkPackageName]: input.state.project.framework.version } }))
    assert.equal((await input.node.inspect(input.state)).fatal, true)
    await assert.rejects(input.node.install(input.state), /dev 和 build/)
    assert.deepEqual(input.executor.calls, [])
    await write(resolve(input.uiRoot, "package.json"), packageJsonFile.make(input.state))
    await input.node.install(input.state)
    input.executor.handler = async () => { }
    await assert.rejects(input.node.build(input.state), /ENOENT|app\.js/)
})

test("安装取消即使退出码为零也抛 AbortError，旧准备记录不能继续使用", async t => {
    const input = await setup(t)
    await input.node.install(input.state)
    assert.equal((await input.node.inspect(input.state)).ready, true)
    input.executor.cancelled = true
    await assert.rejects(input.node.install(input.state), error => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, "AbortError")
        assert.match(error.message, /已取消/)
        return true
    })
    await assert.rejects(readFile(resolve(input.state.rootDir, ".arrange", uiPreparationFileName)), { code: "ENOENT" })
    assert.equal((await input.node.inspect(input.state)).ready, false)
    input.executor.cancelled = false
    await input.node.install(input.state)
    assert.equal((await input.node.inspect(input.state)).ready, true)
})

test("构建取消保留 AbortError 并使旧 completed 记录失效；普通退出失败不伪装取消", async t => {
    const input = await setup(t)
    await input.node.install(input.state)
    const ui = new UiBuildService(input.node)
    const receiptPath = resolve(input.state.rootDir, ".arrange/built-ui.json")
    await ui.build(input.state)
    assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).status, "completed")
    input.executor.cancelled = true
    input.executor.exitCode = 130
    await assert.rejects(ui.build(input.state), error => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, "AbortError")
        assert.match(error.message, /已取消/)
        return true
    })
    const cancelled = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.equal(cancelled.status, "failed")
    assert.equal(cancelled.path, undefined)
    assert.equal(cancelled.projectVersion, input.state.project.project.version)
    input.executor.cancelled = false
    input.executor.exitCode = 1
    await assert.rejects(ui.build(input.state), error => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, "Error")
        assert.match(error.message, /UI 构建失败，退出码 1/)
        return true
    })
    assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).status, "failed")
})
