import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer as createTcpServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { cliCompatibility, frameworkPackageName } from "../src/CliMetadata.ts"
import { configRegistry } from "../src/config/ConfigRegistry.ts"
import { RegistryUnreachableError } from "../src/framework/FrameworkErrors.ts"
import { FrameworkRegistryClient } from "../src/framework/FrameworkRegistryClient.ts"
import { FrameworkService } from "../src/framework/FrameworkService.ts"
import { FrameworkSourceProbe, frameworkSourceProblem } from "../src/framework/FrameworkSourceProbe.ts"
import { Executor } from "../src/platform/Executor.ts"
import { locateTool } from "../src/platform/ToolLocator.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { ConfigApplier } from "../src/sync/ConfigApplier.ts"
import { ConfigResolver } from "../src/sync/ConfigResolver.ts"
import { ConfigScanner } from "../src/sync/ConfigScanner.ts"
import { ConfigWriter } from "../src/sync/ConfigWriter.ts"
import { SyncService } from "../src/sync/SyncService.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { fixture, TestSyncWizard, write, quietTerminal } from "./fixture.ts"

// 一个刚关闭的本机端口：连接它必然被拒绝（ECONNREFUSED），不依赖外部网络
async function closedPort(): Promise<number> {
    const server = createTcpServer()
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))
    return port
}

test("连不上 registry 归为 RegistryUnreachableError，带上地址与真实原因而不是 fetch failed", async () => {
    const registry = `http://127.0.0.1:${await closedPort()}`
    const client = new FrameworkRegistryClient()
    for (const call of [() => client.fetchCandidateByVersion("0.0.0-m.3.0", registry), () => client.fetchCandidates(5, registry)]) {
        await assert.rejects(call(), error => {
            assert.ok(error instanceof RegistryUnreachableError)
            assert.equal(error.registry, registry)
            assert.match(error.message, new RegExp(registry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
            assert.match(error.message, /ECONNREFUSED/)
            assert.doesNotMatch(error.message, /^fetch failed/)
            return true
        })
    }
})

test("registry 可达但给出否定答案（HTTP 404）不算连不上", async t => {
    const server = createHttpServer((_request, response) => { response.writeHead(404).end("{}") })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
    const registry = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await assert.rejects(new FrameworkRegistryClient().fetchCandidateByVersion("9.9.9", registry), error => {
        assert.ok(!(error instanceof RegistryUnreachableError))
        assert.match((error as Error).message, /HTTP 404/)
        return true
    })
})

test("用户取消仍以 AbortError 传出，不被当成连不上", async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(new FrameworkRegistryClient(controller.signal).fetchCandidateByVersion("0.0.0-m.3.0", `http://127.0.0.1:${await closedPort()}`), error => (error as Error).name === "AbortError")
})

class UnreachableRegistry extends FrameworkRegistryClient {
    calls = 0
    override async fetchCandidateByVersion(): Promise<never> {
        this.calls++
        throw new RegistryUnreachableError("http://registry.example.invalid", "ECONNREFUSED")
    }
}

class IncompatibleRegistry extends FrameworkRegistryClient {
    override async fetchCandidateByVersion(version: string) {
        return { version, cliCompatibility: cliCompatibility + 1, markedLatest: false, publishedAt: null }
    }
}

function runSync(registry: FrameworkRegistryClient, wizard: TestSyncWizard): SyncService {
    const signal = new AbortController().signal
    const writer = new ConfigWriter(signal)
    return new SyncService(new ProjectStateStore(new FileTransaction(signal)), new FrameworkService(registry), new ConfigScanner(configRegistry), new ConfigResolver(writer, wizard, signal), new ConfigApplier(writer), { run: async () => ({ status: "blocked" }) }, wizard, signal, quietTerminal().tasks)
}

test("sync：连不上 registry 且本机没有已安装版本 → Fatal framework-unverifiable，说明地址、原因和缺少的离线依据", async t => {
    const state = await fixture(t)
    const registry = new UnreachableRegistry()
    const wizard = new TestSyncWizard()
    const result = await runSync(registry, wizard).run({ configOnly: true }, state.rootDir)
    assert.equal(result.status, "blocked")
    const fatal = wizard.reports[0].fatal.find(item => item.cause === "framework-unverifiable")
    assert.ok(fatal, JSON.stringify(wizard.reports[0].fatal))
    assert.match(fatal.message, /registry\.example\.invalid/)
    assert.match(fatal.message, /ECONNREFUSED/)
    assert.match(fatal.message, /没有可用于离线验证/)
    assert.equal(wizard.reports[0].fatal.some(item => item.cause === "framework-incompatible"), false)
})

test("sync：registry 明确给出不兼容 → 仍是 framework-incompatible", async t => {
    const state = await fixture(t)
    const wizard = new TestSyncWizard()
    await runSync(new IncompatibleRegistry(), wizard).run({ configOnly: true }, state.rootDir)
    assert.equal(wizard.reports[0].fatal.some(item => item.cause === "framework-incompatible"), true)
    assert.equal(wizard.reports[0].fatal.some(item => item.cause === "framework-unverifiable"), false)
})

test("sync：本机已安装匹配版本时优先使用，registry 不可达也不阻塞，且根本不联网", async t => {
    const state = await fixture(t)
    await write(join(state.rootDir, state.project.ui.directory, "node_modules", frameworkPackageName, "package.json"), JSON.stringify({ version: state.project.framework.version, arrange: { cliCompatibility } }))
    const registry = new UnreachableRegistry()
    const wizard = new TestSyncWizard()
    const result = await runSync(registry, wizard).run({ configOnly: true }, state.rootDir)
    assert.equal(result.status, "completed")
    assert.equal(wizard.reports[0].fatal.length, 0)
    assert.equal(registry.calls, 0)
})

// ---- Arrange 原生源码预检：用真实的本地 git 仓库验证，不依赖外部网络 ----

const git = await locateTool("git")

async function repository(t: TestContext, tags: readonly string[]): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "arrange-source-probe-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const run = (...args: string[]) => execFileSync(git!, ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], { cwd: directory, stdio: "ignore" })
    run("init", "-q")
    run("commit", "-q", "--allow-empty", "-m", "initial")
    for (const tag of tags) run("tag", tag)
    return directory
}

async function probeState(t: TestContext, url: string, version = "1.2.3") {
    const state = await fixture(t, false)
    state.project.framework.version = version
    state.project.framework.cmakeFetchContentUrl = url
    return state
}

const probe = new FrameworkSourceProbe(new Executor())
const needsGit = git ? false : "需要 git"

test("预检：仓库可达且 tag 存在 → ok", { skip: needsGit }, async t => {
    const state = await probeState(t, await repository(t, ["v1.2.3"]))
    assert.deepEqual(await probe.check(state), { kind: "ok" })
    assert.equal(frameworkSourceProblem({ kind: "ok" }), undefined)
})

test("预检：仓库可达但没有对应 tag → tag-missing，说明 tag、版本与本地源码出路", { skip: needsGit }, async t => {
    const url = await repository(t, ["v9.9.9"])
    const check = await probe.check(await probeState(t, url))
    assert.equal(check.kind, "tag-missing")
    const message = frameworkSourceProblem(check)!
    assert.match(message, /没有 tag v1\.2\.3/)
    assert.match(message, /Framework 1\.2\.3/)
    assert.match(message, /FETCHCONTENT_SOURCE_DIR_ARRANGE/)
})

test("预检：仓库不存在或连不上 → unreachable，带地址与 git 的原因", { skip: needsGit }, async t => {
    const url = join(tmpdir(), "arrange-no-such-repository")
    const check = await probe.check(await probeState(t, url))
    assert.equal(check.kind, "unreachable")
    assert.match(frameworkSourceProblem(check)!, /无法访问 Arrange 源码仓库/)
})

test("预检：仓库地址里的凭据不出现在报错中", { skip: needsGit }, async t => {
    const check = await probe.check(await probeState(t, `http://user:secret-token@127.0.0.1:${await closedPort()}/Arrange.git`))
    assert.equal(check.kind, "unreachable")
    assert.doesNotMatch(JSON.stringify(check), /secret-token/)
    assert.doesNotMatch(frameworkSourceProblem(check)!, /secret-token/)
})

test("预检：已用 FETCHCONTENT_SOURCE_DIR_ARRANGE 覆盖本地源码时跳过，不联网", { skip: needsGit }, async t => {
    const state = await probeState(t, join(tmpdir(), "arrange-no-such-repository"))
    state.local = { native: { generator: "Ninja", architecture: "x64", cmakeDefinitions: { FETCHCONTENT_SOURCE_DIR_ARRANGE: "/local/arrange" } } }
    assert.deepEqual(await probe.check(state), { kind: "skipped" })
})

test("预检：仓库地址或版本不由 CLI 托管时不知道 CMake 会取什么，跳过", async t => {
    for (const unmanaged of ["cmake.fetch-content-repository", "framework.version"]) {
        const state = await probeState(t, join(tmpdir(), "arrange-no-such-repository"))
        state.project["managed-items"] = state.project["managed-items"].filter(id => id !== unmanaged)
        assert.deepEqual(await probe.check(state), { kind: "skipped" }, unmanaged)
    }
})

test("预检：找不到 git → git-missing，明确说需要 git", async t => {
    const check = await new FrameworkSourceProbe(new Executor(), async () => undefined).check(await probeState(t, "https://example.invalid/Arrange.git"))
    assert.deepEqual(check, { kind: "git-missing" })
    assert.match(frameworkSourceProblem(check)!, /未找到 git/)
})
