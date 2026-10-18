import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:http"
import type { Socket } from "node:net"
import test, { type TestContext } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { UserDirectories } from "../src/feature/user/UserDirectories.ts"
import { SourceCache } from "../src/feature/source/SourceCache.ts"
import { GitSource } from "../src/feature/source/GitSource.ts"
import { sourceIdentity, type SourceSpec } from "../src/feature/source/SourceSpec.ts"
import { Executor } from "../src/feature/platform/Executor.ts"
import { isAbortError, type ProcessSpec } from "../src/feature/platform/ProcessSpec.ts"
import { testTask, write, stateFor } from "./fixture.ts"
import { readNativeDependencies } from "../src/feature/source/NativeDependencies.ts"
import { NativeSourceService } from "../src/feature/source/NativeSourceService.ts"
import { OperationHost } from "../src/feature/operation/OperationHost.ts"
import { Operations } from "../src/feature/operation/Operations.ts"
import { FrameworkSourceProbe } from "../src/feature/framework/FrameworkSourceProbe.ts"
import { sourceLocalTimeoutMs } from "../src/CliMetadata.ts"

const commit = "a".repeat(40)
const spec: SourceSpec = { repository: "https://example.invalid/source.git", ref: "v1", commit }

async function cacheFixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "arrange-source-"))
    const user = new UserDirectories(join(root, "user"))
    const signal = new AbortController()
    const host = new OperationHost(user)
    const hosts = [host]
    t.after(async () => {
        await Promise.all(hosts.map(host => host.close()))
        await rm(root, { recursive: true, force: true })
    })
    const operations = new Operations(host, signal.signal, () => { })
    let calls = 0
    const git = {
        verify: async () => { }, checkout: async (request: SourceSpec, directory: string, _task: unknown, held: AbortSignal) => {
            calls++
            await delay(25, undefined, { signal: held })
            const hash = request.commit ?? commit
            await write(join(directory, "CMakeLists.txt"), "project(Fixture NONE)\n")
            await write(join(directory, ".git", "HEAD"), `${hash}\n`)
            return hash
        }
    }
    const cache = new SourceCache(user, git, signal.signal, operations)
    return { root, user, signal, git, cache, operations, hosts, calls: () => calls }
}

test("用户目录解析不写磁盘，拒绝相对路径，统一区分用户与工程作用域", async t => {
    const input = await cacheFixture(t)
    assert.throws(() => new UserDirectories("relative"), /绝对路径/)
    assert.equal(input.user.builds, join(input.user.root, "builds"))
    assert.equal(input.user.runtime, join(input.user.root, "runtime"))
    assert.equal(await input.cache.find(spec), undefined)
    await assert.rejects(readdir(input.user.root), { code: "ENOENT" })
})

test("同一设备的多个服务并发只获取一次；缓存命中不联网，源码版本相互隔离", async t => {
    const input = await cacheFixture(t)
    const second = new SourceCache(input.user, input.git, input.signal.signal, input.operations)
    const [first, other] = await Promise.all([input.cache.ensure(spec, "Fixture", testTask()), second.ensure(spec, "Fixture", testTask())])
    assert.deepEqual(first, other)
    assert.equal(input.calls(), 1)
    const offline = new SourceCache(input.user, { verify: async () => { }, checkout: async () => { throw new Error("断网") } }, input.signal.signal, input.operations)
    assert.deepEqual(await offline.ensure(spec, "Fixture", testTask()), first)
    const newer = await input.cache.ensure({ ...spec, ref: "v2", commit: "b".repeat(40) }, "Fixture", testTask())
    assert.notEqual(newer.directory, first.directory)
    assert.deepEqual(await input.cache.find(spec), first)
    const mirror = await input.cache.ensure({ ...spec, repository: "https://mirror.invalid/source.git" }, "Fixture", testTask())
    assert.notEqual(mirror.directory, first.directory)
    const alias = await input.cache.ensure({ ...spec, ref: "another-tag" }, "Fixture", testTask())
    assert.equal(alias.directory, first.directory)
})

test("取消未完成的获取不发布缓存，重试成功且清理临时内容", async t => {
    const input = await cacheFixture(t)
    const pending = input.cache.ensure(spec, "Fixture", testTask())
    setTimeout(() => input.signal.abort(), 10)
    await assert.rejects(pending, isAbortError)
    assert.equal(await input.cache.find(spec), undefined)
    const retryHost = new OperationHost(input.user)
    input.hosts.push(retryHost)
    const retry = new SourceCache(input.user, input.git, new AbortController().signal, new Operations(retryHost, new AbortController().signal, () => { }))
    assert.equal((await retry.ensure(spec, "Fixture", testTask())).commit, commit)
    assert.deepEqual(await readdir(join(input.user.dependencySources, "tmp")), [])
})

test("缓存损坏或目录别名明确失败，不清理目录之外的内容", async t => {
    const input = await cacheFixture(t)
    const source = await input.cache.ensure(spec, "Fixture", testTask())
    await write(join(source.directory, ".git", "HEAD"), `${"b".repeat(40)}\n`)
    await assert.rejects(input.cache.find(spec), /checkout 已被修改/)
    await write(join(source.directory, ".git", "HEAD"), `${commit}\n`)
    const external = join(input.root, "external")
    await mkdir(external)
    await write(join(external, "keep"), "external")
    await rm(source.directory, { recursive: true })
    await symlink(external, source.directory, process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(input.cache.ensure(spec, "Fixture", testTask()), /符号链接/)
    assert.equal(await readFile(join(external, "keep"), "utf8"), "external")
})

test("依赖清单是唯一事实源，缺失、损坏或缺少固定 commit 明确失败", async t => {
    const input = await cacheFixture(t)
    const manifest = await readNativeDependencies(resolve(import.meta.dirname, "../.."))
    assert.equal(manifest.juce.ref, "8.0.12")
    assert.ok(manifest.juce.commit)
    await write(join(input.root, "cmake", "Dependencies.cmake"), 'set(ARRANGE_JUCE_GIT_TAG "8" CACHE STRING "Tag")\n')
    await assert.rejects(readNativeDependencies(input.root), /依赖清单缺失/)
    const path = join(input.root, "cmake", "NativeDependencies.json")
    await write(path, "invalid json")
    await assert.rejects(readNativeDependencies(input.root), /依赖清单无效/)
    const { commit: _commit, ...unpinned } = spec
    await write(path, JSON.stringify({ schema: 1, juce: unpinned, quickjs_ng: spec }))
    await assert.rejects(readNativeDependencies(input.root), /依赖清单无效/)
    await write(path, JSON.stringify({ schema: 1, juce: spec, quickjs_ng: spec }))
    assert.equal((await readNativeDependencies(input.root)).juce.commit, spec.commit)
})

test("依赖按 Arrange 清单准备，尊重源码与版本覆盖；缓存预检无需 git 或网络", async t => {
    const input = await cacheFixture(t)
    const state = stateFor(input.root)
    const manifest = { schema: 1, juce: spec, quickjs_ng: { ...spec, repository: "https://example.invalid/qjs", ref: "v0" } }
    const checkout = input.git.checkout
    input.git.checkout = async (...args) => {
        if (args[0].ref === "custom") args[0] = { ...args[0], commit: "b".repeat(40) }
        const hash = await checkout(...args)
        if (args[0].repository.includes("Arrange")) await write(join(args[1], "cmake", "NativeDependencies.json"), JSON.stringify(manifest))
        return hash
    }
    const service = new NativeSourceService(input.cache)
    const definitions = await service.prepare(state, testTask())
    assert.deepEqual(Object.keys(definitions).sort(), ["FETCHCONTENT_SOURCE_DIR_ARRANGE", "FETCHCONTENT_SOURCE_DIR_JUCE", "FETCHCONTENT_SOURCE_DIR_QUICKJS_NG"])
    const probe = new FrameworkSourceProbe(new Executor(), async () => { throw new Error("不应找 git") }, service)
    assert.equal((await probe.check(state)).kind, "ok")
    state.local = { native: { generator: "Ninja", architecture: "x64", cmakeDefinitions: { JUCE_DIR: "/user/juce", ARRANGE_QUICKJS_NG_GIT_TAG: "custom" } } }
    const overridden = await service.prepare(state, testTask())
    assert.equal(overridden.FETCHCONTENT_SOURCE_DIR_JUCE, undefined)
    assert.notEqual(overridden.FETCHCONTENT_SOURCE_DIR_QUICKJS_NG, definitions.FETCHCONTENT_SOURCE_DIR_QUICKJS_NG)
    state.project["managed-items"] = []
    assert.deepEqual(await service.prepare(state, testTask()), {})
})

test("真实 Git 获取固定 tag，缓存复用不 fetch，错误 commit 不发布", async t => {
    const input = await cacheFixture(t)
    const repository = join(input.root, "repository with spaces")
    await mkdir(repository)
    const executor = new Executor()
    for (const args of [["init", "--quiet"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"]]) assert.equal((await executor.run({ command: "git", args, cwd: repository })).exitCode, 0)
    await write(join(repository, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.24)\nproject(Fixture NONE)\n")
    for (const args of [["add", "."], ["commit", "--quiet", "-m", "fixture"], ["tag", "v1"]]) assert.equal((await executor.run({ command: "git", args, cwd: repository })).exitCode, 0)
    const revision = (await executor.run({ command: "git", args: ["rev-parse", "HEAD"], cwd: repository })).stdout.trim()
    let fetches = 0
    const recording = new class extends Executor {
        override async run(process: ProcessSpec) {
            assert.equal(process.timeoutMs, process.args.includes("fetch") || process.args.includes("submodule") ? undefined : sourceLocalTimeoutMs)
            if (process.args.includes("fetch")) fetches++
            return super.run(process)
        }
    }()
    const cache = new SourceCache(input.user, new GitSource(recording), input.signal.signal, input.operations)
    const request = { repository, ref: "v1", commit: revision }
    const source = await cache.ensure(request, "Fixture", testTask())
    assert.equal(source.commit, revision)
    assert.deepEqual(await cache.ensure(request, "Fixture", testTask()), source)
    assert.equal(fetches, 1)
    await write(join(source.directory, "CMakeLists.txt"), "modified cached source\n")
    const modified = new SourceCache(input.user, new GitSource(recording), input.signal.signal, input.operations)
    await assert.rejects(modified.ensure(request, "Fixture", testTask()), /已被修改/)
    await assert.rejects(cache.ensure({ ...request, commit }, "Fixture", testTask()), /commit 与依赖清单不符/)
    assert.equal(await cache.find({ ...request, commit }), undefined)
    assert.deepEqual(await readdir(join(input.user.dependencySources, "tmp")), [])
})

test("真实 Git 网络获取无总时长上限，静默等待可取消且不发布半成品", { timeout: 15000 }, async t => {
    const input = await cacheFixture(t)
    const sockets = new Set<Socket>()
    let requested!: () => void
    const request = new Promise<void>(resolve => { requested = resolve })
    const server = createServer(() => requested())
    server.on("connection", socket => {
        sockets.add(socket)
        socket.once("close", () => sockets.delete(socket))
    })
    t.after(async () => {
        input.signal.abort()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    const host = new OperationHost(input.user)
    input.hosts.push(host)
    const executor = new class extends Executor {
        override async run(process: ProcessSpec) {
            if (process.args.includes("fetch")) assert.equal(process.timeoutMs, undefined)
            return super.run(process)
        }
    }(process.platform, input.signal.signal, host)
    const cache = new SourceCache(input.user, new GitSource(executor), input.signal.signal, input.operations)
    const pending = cache.ensure({ repository: `http://127.0.0.1:${address.port}/source.git`, ref: "v1", commit }, "网络等待夹具", testTask())
    const cancelled = assert.rejects(pending, isAbortError)
    await Promise.race([request, pending])
    input.signal.abort()
    await cancelled
    assert.deepEqual(await readdir(join(input.user.dependencySources, "entries")), [])
    assert.deepEqual(await readdir(join(input.user.dependencySources, "requests")), [])
    assert.deepEqual(await readdir(join(input.user.dependencySources, "tmp")), [])
})

test("两个真实 CLI 工作进程共享同一缓存，只获取一份源码", async t => {
    const input = await cacheFixture(t)
    const counter = join(input.root, "fetches.txt")
    const worker = join(import.meta.dirname, "fixtures", "source-cache-worker.ts")
    const executor = new Executor()
    const run = () => executor.run({ command: process.execPath, args: ["--import", "tsx", worker, input.user.root, counter], timeoutMs: 10000 })
    const results = await Promise.all([run(), run()])
    for (const result of results) assert.equal(result.exitCode, 0, result.stderr)
    assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 1)
    assert.equal(results[0].stdout.trim(), results[1].stdout.trim())
})

test("真实 Git 相对子模块完整获取，原子移动后仍可校验和复用", async t => {
    const input = await cacheFixture(t)
    const previous = process.env.GIT_ALLOW_PROTOCOL
    process.env.GIT_ALLOW_PROTOCOL = "file"
    t.after(() => {
        if (previous === undefined) delete process.env.GIT_ALLOW_PROTOCOL
        else process.env.GIT_ALLOW_PROTOCOL = previous
    })
    const executor = new Executor()
    const run = async (cwd: string, args: readonly string[]) => {
        const result = await executor.run({ command: "git", args, cwd })
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout.trim()
    }
    const repositories = join(input.root, "repos")
    const child = join(repositories, "child")
    const parent = join(repositories, "parent")
    for (const directory of [child, parent]) {
        await mkdir(directory, { recursive: true })
        await run(directory, ["init", "--quiet"])
        await run(directory, ["config", "user.name", "Fixture"])
        await run(directory, ["config", "user.email", "fixture@example.invalid"])
        await write(join(directory, "CMakeLists.txt"), "project(Fixture NONE)\n")
        await run(directory, ["add", "."])
        await run(directory, ["commit", "--quiet", "-m", "fixture"])
    }
    await run(parent, ["submodule", "add", "../child", "modules/child"])
    await run(parent, ["commit", "--quiet", "-am", "relative submodule"])
    await run(parent, ["tag", "v1"])
    const request = { repository: parent, ref: "v1", commit: await run(parent, ["rev-parse", "HEAD"]) }
    const cache = new SourceCache(input.user, new GitSource(executor), input.signal.signal, input.operations)
    const cached = await cache.ensure(request, "Fixture", testTask())
    assert.equal(await readFile(join(cached.directory, "modules", "child", "CMakeLists.txt"), "utf8"), "project(Fixture NONE)\n")
    assert.deepEqual(await cache.ensure(request, "Fixture", testTask()), cached)
    assert.equal(await run(cached.directory, ["diff", "--quiet", "HEAD", "--"]), "")
})
