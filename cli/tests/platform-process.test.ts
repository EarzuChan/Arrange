import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Executor, quoteWindowsArgument } from "../src/platform/Executor.ts"
import { DevSupervisor } from "../src/platform/DevSupervisor.ts"
import { parseMsvcArchitecture, parseWindowsEnvironment, WindowsPlatformService } from "../src/platform/WindowsPlatformService.ts"
import { satisfiesMinimumVersion, ToolchainService } from "../src/platform/ToolchainService.ts"
import { MacPlatformService } from "../src/platform/MacPlatformService.ts"
import type { ProcessResult, ProcessSpec } from "../src/platform/ProcessSpec.ts"
import { isAbortError, throwIfProcessCancelled } from "../src/platform/ProcessSpec.ts"
import { stateFor } from "./fixture.ts"

async function freePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))
    return port
}

test("executor preserves exits, signals, timeout and cancellation", async () => {
    const executor = new Executor()
    const failed = await executor.run({ command: process.execPath, args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"] })
    assert.equal(failed.exitCode, 7)
    assert.equal(failed.stdout, "out")
    assert.equal(failed.stderr, "err")
    const signalled = await executor.run({ command: process.execPath, args: ["-e", "process.kill(process.pid,'SIGTERM')"] })
    assert.notEqual(signalled.exitCode, 0)
    if (process.platform !== "win32") assert.equal(signalled.signal, "SIGTERM")
    const timed = await executor.run({ command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], timeoutMs: 100 })
    assert.equal(timed.exitCode, 124)
    assert.equal(timed.timedOut, true)
    const cancellation = new AbortController()
    const pending = new Executor(process.platform, cancellation.signal).run({ command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] })
    setTimeout(() => cancellation.abort(), 100)
    assert.equal((await pending).exitCode, 130)
})

test("executor stops descendants even after their parent exits", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-process-tree-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const marker = join(directory, "orphan.txt")
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan')`
    const delay = process.platform === "win32" ? 5000 : 700
    const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>{${descendant}},${delay})`)}],{stdio:'ignore'}).unref()`
    const child = new Executor().start({ command: process.execPath, args: ["-e", source] })
    await child.completion
    await child.stop()
    await new Promise(resolve => setTimeout(resolve, delay + 100))
    await assert.rejects(readFile(marker), /ENOENT/)
})

test("executor cleans descendants that retain captured pipes after their parent exits", { timeout: 20000 }, async () => {
    const port = await freePort()
    const descendant = `require('node:http').createServer((q,s)=>s.end('alive')).listen(${port},'127.0.0.1',()=>process.send('ready'))`
    const source = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','inherit','inherit','ipc']});child.on('message',()=>process.exit(7))`
    const result = await new Executor().run({ command: process.execPath, args: ["-e", source], timeoutMs: 15000 })
    assert.equal(result.exitCode, 7)
    assert.equal(result.cancelled, false)
    assert.equal(result.timedOut, false)
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("supervisor waits for UI readiness before native and cleans up on exit", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-readiness-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const port = await freePort()
    const ready = join(directory, "ready")
    const native = join(directory, "native")
    const ui = `setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(ready)},'yes');require('node:http').createServer((q,s)=>{s.setHeader('x-arrange-dev','owned');s.end('ok')}).listen(${port},'127.0.0.1')},250)`
    const source = `if(!require('node:fs').existsSync(${JSON.stringify(ready)}))process.exit(9);require('node:fs').writeFileSync(${JSON.stringify(native)},'yes');setTimeout(()=>process.exit(6),100)`
    const code = await new DevSupervisor(new Executor()).run([
        { name: "native", command: process.execPath, args: ["-e", source], dependsOn: ["ui"], stdio: "capture" },
        { name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${port}`, readyHeader: { name: "x-arrange-dev", value: "owned" }, stdio: "capture" },
    ])
    assert.equal(code, 6)
    assert.equal(await readFile(native, "utf8"), "yes")
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("supervisor refuses occupied ports and propagates cancellation", async () => {
    const server = createHttpServer((request, response) => response.end("ok"))
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try { await assert.rejects(new DevSupervisor(new Executor()).run([{ name: "ui", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], readyUrl: `http://127.0.0.1:${port}` }]), /已被占用/) } finally {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
    const signal = new AbortController()
    const running = new DevSupervisor(new Executor()).run([{ name: "native", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], stdio: "capture" }], { signal: signal.signal })
    setTimeout(() => signal.abort(), 100)
    assert.equal(await running, 0)
})

test("supervisor stops every process when an earlier ready child exits during later readiness", { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-startup-failure-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const uiPort = await freePort()
    const nativePort = await freePort()
    const thirdMarker = join(directory, "third")
    const ui = `require('node:http').createServer((q,s)=>s.end('ok')).listen(${uiPort},'127.0.0.1');setTimeout(()=>process.exit(7),400)`
    const native = `require('node:http').createServer((q,s)=>{s.statusCode=503;s.end('preparing')}).listen(${nativePort},'127.0.0.1')`
    const startedAt = Date.now()
    await assert.rejects(new DevSupervisor(new Executor()).run([
        { name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${uiPort}`, stdio: "capture" },
        { name: "native", command: process.execPath, args: ["-e", native], readyUrl: `http://127.0.0.1:${nativePort}`, dependsOn: ["ui"], stdio: "capture" },
        { name: "third", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(thirdMarker)},'wrong')`], dependsOn: ["native"], stdio: "capture" },
    ], { readinessTimeoutMs: 5000 }), /ui 在准备就绪前退出（7）/)
    assert.ok(Date.now() - startedAt < 3000)
    await assert.rejects(readFile(thirdMarker), /ENOENT/)
    await assert.rejects(fetch(`http://127.0.0.1:${uiPort}`))
    await assert.rejects(fetch(`http://127.0.0.1:${nativePort}`))
})

test("supervisor preserves cleanup failure after cancellation while stopping other children", async () => {
    class CleanupFailureExecutor extends Executor {
        started = 0
        readonly stopped: number[] = []
        override start(spec: ProcessSpec) {
            const child = super.start(spec)
            const ordinal = this.started++
            return {
                ...child, stop: async () => {
                    this.stopped.push(ordinal)
                    await child.stop()
                    if (ordinal === 0) throw new Error("拒绝终止一个子进程")
                }
            }
        }
    }
    const executor = new CleanupFailureExecutor()
    const signal = new AbortController()
    const running = new DevSupervisor(executor).run([
        { name: "ui", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], stdio: "capture" },
        { name: "native", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], stdio: "capture" },
    ], { signal: signal.signal })
    setTimeout(() => signal.abort(), 100)
    await assert.rejects(running, /开发进程清理失败.*拒绝终止/)
    assert.deepEqual(executor.stopped, [0, 1])
})

test("supervisor rejects HTTP 200 HTML fallback before starting native", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-fallback-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const port = await freePort()
    const marker = join(directory, "native-started")
    const ui = `require('node:http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<html>fallback</html>')}).listen(${port},'127.0.0.1')`
    const supervisor = new DevSupervisor(new Executor())
    await assert.rejects(supervisor.run([
        {
            name: "ui", command: process.execPath, args: ["-e", ui], stdio: "capture", readyUrl: `http://127.0.0.1:${port}/@arrange/modules`, readyCheck: async response => {
                if (!response.headers.get("content-type")?.includes("application/json")) return false
                const body = await response.json() as { entry?: unknown, modules?: unknown[] }
                return typeof body.entry === "string" && Array.isArray(body.modules) && body.modules.length > 0
            }
        },
        { name: "native", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'wrong')`], dependsOn: ["ui"], stdio: "capture" },
    ], { readinessTimeoutMs: 400 }), /未在限定时间内就绪.*HTTP 200.*<html>fallback<\/html>/)
    await assert.rejects(readFile(marker), /ENOENT/)
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("supervisor readiness timeout reports HTTP errors with a bounded first line", async () => {
    const port = await freePort()
    const ui = `require('node:http').createServer((q,s)=>{s.statusCode=500;s.end('Failed to load module: '+ 'x'.repeat(10000)+'\\nignored second line')}).listen(${port},'127.0.0.1')`
    await assert.rejects(new DevSupervisor(new Executor()).run([
        { name: "ui", command: process.execPath, args: ["-e", ui], stdio: "capture", readyUrl: `http://127.0.0.1:${port}/@arrange/modules` },
    ], { readinessTimeoutMs: 400 }), (error: Error) => {
        assert.match(error.message, /HTTP 500：Failed to load module:/)
        assert.equal(error.message.includes("ignored second line"), false)
        assert.ok(error.message.length < 650)
        return true
    })
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("Windows command and environment boundaries preserve paths and reject expansion", () => {
    assert.equal(quoteWindowsArgument("C:\\Program Files\\pnpm.cmd"), '"C:\\Program Files\\pnpm.cmd"')
    assert.throws(() => quoteWindowsArgument("%PATH%"))
    assert.throws(() => quoteWindowsArgument('x" & exit'))
    assert.deepEqual(parseWindowsEnvironment("banner\r\nPath=C:\\VS;C:\\Windows\r\nVALUE=a=b\r\n=C:=C:\\"), { Path: "C:\\VS;C:\\Windows", VALUE: "a=b" })
    assert.equal(parseMsvcArchitecture("Microsoft (R) C/C++ Optimizing Compiler Version 19.44.35219 for x64"), "x64")
    assert.equal(parseMsvcArchitecture("Microsoft (R) C/C++ Optimizing Compiler Version 19.44.35219 for ARM64"), "arm64")
    assert.equal(parseMsvcArchitecture("Microsoft (R) C/C++ Optimizing Compiler Version 19.44.35219 for x86"), undefined)
    assert.equal(satisfiesMinimumVersion("cmake version 3.24.0", "3.24.0"), true)
    assert.equal(satisfiesMinimumVersion("cmake version 3.23.9", "3.24.0"), false)
})

test("tool discovery validates package manager under the selected Node environment", async () => {
    class ProbeExecutor extends Executor {
        readonly calls: ProcessSpec[] = []
        override async run(spec: ProcessSpec): Promise<ProcessResult> {
            this.calls.push(spec)
            return { exitCode: 0, stdout: spec.command.endsWith("node") ? "v24.18.0" : "10.33.0", stderr: "", cancelled: false, timedOut: false }
        }
    }
    const executor = new ProbeExecutor()
    const state = stateFor("/tmp/unused")
    state.local = { node: { path: "/selected/node/bin/node" }, packageManager: { path: "/tools/npm" } }
    const inspection = await new ToolchainService(executor, new MacPlatformService(executor)).inspect(state, "UI")
    assert.deepEqual(inspection.issues, [])
    assert.equal(executor.calls[1]!.env?.PATH?.startsWith("/selected/node/bin"), true)
    state.project.ui.packageManager = "pnpm"
    assert.equal((await new ToolchainService(executor, new MacPlatformService(executor)).inspect(state, "UI")).issues.some(issue => issue.key === "packageManager"), true)
})

test("Windows native environment checks Developer Prompt target architecture", async () => {
    class EnvironmentExecutor extends Executor {
        output = "VCToolsInstallDir=C:\\VS\\VC\\Tools\\MSVC\\\r\nVSCMD_ARG_TGT_ARCH=x64\r\nPath=C:\\VS\\bin"
        override async run(spec: ProcessSpec): Promise<ProcessResult> {
            assert.equal(spec.windowsVerbatimArguments, true)
            assert.match(spec.args.at(-1)!, /-arch=amd64 -host_arch=amd64/)
            return { exitCode: 0, stdout: this.output, stderr: "", cancelled: false, timedOut: false }
        }
    }
    const executor = new EnvironmentExecutor()
    const platform = new WindowsPlatformService(executor)
    const local = { native: { generator: "Ninja", architecture: "x64" as const, developerCommand: "C:\\Program Files\\VS\\VsDevCmd.bat" } }
    const env = await platform.nativeEnvironment(local)
    assert.equal(env.Path, "C:\\VS\\bin")
    executor.output = executor.output.replace("VSCMD_ARG_TGT_ARCH=x64", "VSCMD_ARG_TGT_ARCH=x86")
    await assert.rejects(platform.nativeEnvironment(local), /目标架构/)
})

test("tool probes preserve cancellation rather than producing toolchain issues", async () => {
    class CancelledExecutor extends Executor {
        override async run(): Promise<ProcessResult> {
            return { exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }
        }
    }
    const executor = new CancelledExecutor()
    const state = stateFor("/tmp/unused")
    state.local = { node: { path: process.execPath }, native: { generator: "Ninja", architecture: "x64" } }
    assert.throws(() => throwIfProcessCancelled({ exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }), isAbortError)
    await assert.rejects(new ToolchainService(executor, new MacPlatformService(executor)).inspect(state, "UI"), isAbortError)
    await assert.rejects(new MacPlatformService(executor).discoverNative(state.local), isAbortError)
    await assert.rejects(new WindowsPlatformService(executor).discoverNative(state.local), isAbortError)
})
