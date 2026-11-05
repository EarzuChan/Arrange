import { windowsOnly, nativeTools, hostArchitecture } from "./native-fixture.ts"
import { createPlatformService } from "../src/feature/platform/CreatePlatformService.ts"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Executor, quoteWindowsArgument } from "../src/feature/platform/Executor.ts"
import { DevSupervisor } from "../src/feature/platform/DevSupervisor.ts"
import { parseMsvcArchitecture, parseWindowsEnvironment, WindowsPlatformService } from "../src/feature/platform/WindowsPlatformService.ts"
import { satisfiesMinimumVersion, ToolchainService } from "../src/feature/platform/ToolchainService.ts"
import type { ProcessResult, ProcessSpec } from "../src/feature/platform/ProcessSpec.ts"
import type { ProcessOutcome, ProcessProgress, ProcessProgressGroup, TaskSpec } from "../src/feature/operation/Work.ts"
import { isAbortError, throwIfProcessCancelled } from "../src/feature/platform/ProcessSpec.ts"
import { stateFor } from "./fixture.ts"
import { minimumNodeMajor } from "../src/CliMetadata.ts"
import { ManagedProcesses } from "../src/feature/operation/ManagedProcesses.ts"
import { WindowsTreeScanContainment } from "../src/feature/platform/WindowsTreeScan.ts"
import type { CleanupVerdict, RunningProcess } from "../src/feature/platform/ProcessSpec.ts"
import type { ProcessContainer, ProcessContainment } from "../src/feature/platform/ProcessContainer.ts"

async function freePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))
    return port
}

test("进程执行保留退出码、信号、超时与取消结果", async () => {
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

test("父进程退出后仍停止其后代进程", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-process-tree-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const marker = join(directory, "orphan.txt")
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan')`
    const delay = process.platform === "win32" ? 5000 : 700
    const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>{${descendant}},${delay})`)}],{stdio:'ignore'}).unref()`
    const child = new Executor().start({ command: process.execPath, args: ["-e", source] })
    await child.completion
    assert.ok(["clean", "reaped"].includes(await child.stop()))
    await new Promise(resolve => setTimeout(resolve, delay + 100))
    await assert.rejects(readFile(marker), /ENOENT/)
})

test("没有后代的进程清理结论为 clean，重复清理结论不变", async () => {
    const child = new Executor().start({ command: process.execPath, args: ["-e", "0"] })
    await child.completion
    assert.equal(await child.stop(), "clean")
    assert.equal(await child.stop(), "clean")
})

test("脱离父进程的长驻后代由容器确认并结束，结论为 reaped", { timeout: 20000 }, async () => {
    const port = await freePort()
    const descendant = `require('node:http').createServer((q,s)=>s.end('alive')).listen(${port},'127.0.0.1',()=>process.send('ready'))`
    // 后代断开 IPC 后与父进程互不相干，父进程先行退出，Windows 与 POSIX 都不会自动带走它
    const source = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});child.on('message',()=>{child.disconnect();child.unref();process.exit(0)})`
    const child = new Executor().start({ command: process.execPath, args: ["-e", source] })
    const result = await child.completion
    assert.equal(result.exitCode, 0)
    const verdict = await child.stop()
    assert.ok(["reaped", "clean"].includes(verdict))
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

class ScriptedContainer implements ProcessContainer {
    reaps = 0
    constructor(private readonly verdicts: CleanupVerdict[]) { }
    async reap(): Promise<CleanupVerdict> { return this.verdicts[Math.min(this.reaps++, this.verdicts.length - 1)]! }
    releaseIfEmpty(): void { }
}

function scripted(container: ProcessContainer): ProcessContainment {
    return { contain: () => container }
}

test("清理结论为 unknown 时 stop 不抛错，可重试并在确认后固定结论", async () => {
    const container = new ScriptedContainer(["unknown", "unknown", "reaped"])
    const child = new Executor(process.platform, undefined, undefined, scripted(container)).start({ command: process.execPath, args: ["-e", "0"] })
    const result = await child.completion
    assert.equal(result.exitCode, 0)
    assert.equal(await child.stop(), "unknown")
    assert.equal(await child.stop(), "unknown")
    assert.equal(await child.stop(), "reaped")
    assert.equal(await child.stop(), "reaped")
    assert.equal(container.reaps, 3)
})

test("容器清理动作出错时 stop 拒绝，之后仍可重试", async () => {
    let attempts = 0
    const container: ProcessContainer = { reap: async () => { if (attempts++ === 0) throw new Error("无法执行清理"); return "clean" }, releaseIfEmpty() { } }
    const child = new Executor(process.platform, undefined, undefined, scripted(container)).start({ command: process.execPath, args: ["-e", "0"] })
    await child.completion
    await assert.rejects(child.stop(), /无法执行清理/)
    assert.equal(await child.stop(), "clean")
})

test("主进程已关闭后内部触发的清理出错，不使完成结果失败", async () => {
    const container: ProcessContainer = { reap: async () => { throw new Error("无法执行清理") }, releaseIfEmpty() { } }
    const child = new Executor(process.platform, undefined, undefined, scripted(container)).start({ command: process.execPath, args: ["-e", "setTimeout(()=>{},300)"], timeoutMs: 100 })
    const result = await child.completion.catch(error => error)
    assert.ok(result instanceof Error, "主进程仍在运行时清理出错应让执行失败")
    const done = new Executor(process.platform, undefined, undefined, scripted(container)).start({ command: process.execPath, args: ["-e", "process.stdout.write('x')"] })
    assert.equal((await done.completion).exitCode, 0)
    await assert.rejects(done.stop(), /无法执行清理/)
})

test("后代清理未确认不改变已成功的任务结果", async () => {
    const result = await new Executor(process.platform, undefined, undefined, scripted(new ScriptedContainer(["unknown"]))).run({ command: process.execPath, args: ["-e", "process.stdout.write('done')"] })
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, "done")
})

function fakeProcess(verdicts: (CleanupVerdict | Error)[]): RunningProcess {
    let stops = 0
    return {
        pid: 1, completion: Promise.resolve({ exitCode: 0, stdout: "", stderr: "", cancelled: false, timedOut: false }),
        async stop(): Promise<CleanupVerdict> {
            const next = verdicts[Math.min(stops++, verdicts.length - 1)]!
            if (next instanceof Error) throw next
            return next
        }
    }
}

test("清理账本只在确认结束后撤销登记，未确认的保持并可重试", async () => {
    const retired: string[] = []
    const processes = new ManagedProcesses(async id => { retired.push(id) })
    processes.add("a", fakeProcess(["clean"]))
    processes.add("b", fakeProcess(["unknown", "reaped"]))
    processes.add("c", fakeProcess([new Error("无法执行清理"), "clean"]))
    assert.equal(await processes.confirm("a"), "clean")
    assert.equal(await processes.confirm("b"), "unknown")
    assert.equal(await processes.confirm("c"), "unknown")
    assert.deepEqual(retired, ["a"])
    assert.equal(processes.pending, true)
    assert.equal(await processes.retry(), true)
    assert.deepEqual(retired.sort(), ["a", "b", "c"])
    assert.equal(processes.pending, false)
})

test("清理账本在重试仍未确认时继续报告未完成", async () => {
    const processes = new ManagedProcesses(async () => { })
    processes.add("stuck", fakeProcess(["unknown"]))
    assert.equal(await processes.stopAll(), false)
    assert.equal(await processes.retry(), false)
    assert.equal(processes.pending, true)
})

test("清理账本可撤销从未启动成功的登记", async () => {
    const retired: string[] = []
    const processes = new ManagedProcesses(async id => { retired.push(id) })
    processes.add("never", fakeProcess(["unknown"]))
    processes.markUnconfirmed("never")
    await processes.discard("never")
    assert.deepEqual(retired, ["never"])
    assert.equal(processes.pending, false)
})

test("Windows 兜底扫描容器仍能结束已退出父进程留下的后代", { ...windowsOnly, timeout: 60000 }, async () => {
    const port = await freePort()
    const descendant = `require('node:http').createServer((q,s)=>s.end('alive')).listen(${port},'127.0.0.1',()=>process.send('ready'))`
    const source = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});child.on('message',()=>{child.disconnect();process.exit(0)})`
    const child = new Executor("win32", undefined, undefined, new WindowsTreeScanContainment()).start({ command: process.execPath, args: ["-e", source] })
    await child.completion
    assert.ok(["clean", "reaped"].includes(await child.stop()))
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("父进程退出后清理仍持有捕获管道的后代进程", { timeout: 20000 }, async () => {
    const port = await freePort()
    const descendant = `require('node:http').createServer((q,s)=>s.end('alive')).listen(${port},'127.0.0.1',()=>process.send('ready'))`
    const source = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','inherit','inherit','ipc']});child.on('message',()=>process.exit(7))`
    const result = await new Executor().run({ command: process.execPath, args: ["-e", source], timeoutMs: 15000 })
    assert.equal(result.exitCode, 7)
    assert.equal(result.cancelled, false)
    assert.equal(result.timedOut, false)
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("开发监管等待 UI 就绪后启动原生进程，并在退出时清理", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-readiness-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const port = await freePort()
    const ready = join(directory, "ready")
    const native = join(directory, "native")
    const ui = `setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(ready)},'yes');require('node:http').createServer((q,s)=>{s.setHeader('x-arrange-dev','owned');s.end('ok')}).listen(${port},'127.0.0.1')},250)`
    const source = `if(!require('node:fs').existsSync(${JSON.stringify(ready)}))process.exit(9);require('node:fs').writeFileSync(${JSON.stringify(native)},'yes');setTimeout(()=>process.exit(6),100)`
    const code = await new DevSupervisor(new Executor()).run([
        { name: "native", command: process.execPath, args: ["-e", source], dependsOn: ["ui"] },
        { name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${port}`, readyHeader: { name: "x-arrange-dev", value: "owned" } },
    ])
    assert.deepEqual(code, { kind: 'failed', exitCode: 6, message: 'native 意外退出（退出码 6）' })
    assert.equal(await readFile(native, "utf8"), "yes")
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("开发监管拒绝已占用端口，并传递取消结果", async () => {
    const server = createHttpServer((request, response) => response.end("ok"))
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try { await assert.rejects(new DevSupervisor(new Executor()).run([{ name: "ui", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], readyUrl: `http://127.0.0.1:${port}` }]), /已被占用/) } finally {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
    const signal = new AbortController()
    const running = new DevSupervisor(new Executor()).run([{ name: "native", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] }], { signal: signal.signal })
    setTimeout(() => signal.abort(), 100)
    assert.deepEqual(await running, { kind: 'cancelled' })
})

test('用户在全部服务就绪后请求结束是正常结束，UI 和 Native 作为关联进程停止且不失败', async () => {
    class Progress implements ProcessProgressGroup {
        readonly outcomes = new Map<string, ProcessOutcome>()
        async open(spec: TaskSpec): Promise<ProcessProgress> {
            const owner = this
            return {
                title: spec.title,
                line() { }, waiting() { }, stage() { }, progress() { }, process: value => value,
                status() { },
                async finish(outcome) { owner.outcomes.set(spec.id, outcome) }
            }
        }
        async close() { }
        private readonly thisOwner = this
    }
    const port = await freePort()
    const source = `require('node:http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{"entry":"/src/App.sfa","modules":[{"url":"/src/App.sfa","source":"export default {}"}]}')}).listen(${port},'127.0.0.1');setInterval(()=>{},100)`
    const stop = new AbortController()
    const progress = new Progress()
    const running = new DevSupervisor(new Executor()).run([
        { name: 'ui', exitPolicy: 'service', command: process.execPath, args: ['-e', source], readyUrl: 'http://127.0.0.1:' + port, readyCheck: async response => (await response.json() as { modules?: unknown[] }).modules?.length === 1 },
        { name: 'native', command: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], dependsOn: ['ui'] }
    ], { stopSignal: stop.signal, progress, onRunning: () => setTimeout(() => stop.abort(), 100) })
    assert.deepEqual(await running, { kind: 'ended', reason: 'user' })
    assert.deepEqual([...progress.outcomes.values()].map(outcome => outcome.kind).sort(), ['stopped', 'stopped'])
    assert.deepEqual([...progress.outcomes.values()].map(outcome => outcome.kind === 'stopped' ? outcome.reason : '').sort(), ['user', 'user'])
})

test('Standalone 正常关闭自然结束开发会话，UI 作为关联进程停止', { timeout: 10000 }, async () => {
    const port = await freePort()
    const ui = `require('node:http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1');setInterval(()=>{},100)`
    const native = 'setTimeout(()=>process.exit(0),150)'
    const progress: ProcessProgressGroup & { outcomes: ProcessOutcome[] } = {
        outcomes: [], async open() {
            const owner = this
            return { title: '', line() { }, waiting() { }, stage() { }, progress() { }, process: (spec: ProcessSpec) => spec, status() { }, async finish(outcome: ProcessOutcome) { owner.outcomes.push(outcome) } }
        }, async close() { }
    }
    assert.deepEqual(await new DevSupervisor(new Executor()).run([
        { name: 'ui', exitPolicy: 'service', command: process.execPath, args: ['-e', ui], readyUrl: 'http://127.0.0.1:' + port },
        { name: 'native', command: process.execPath, args: ['-e', native], dependsOn: ['ui'] }
    ], { progress }), { kind: 'ended', reason: 'process' })
    assert.equal(progress.outcomes.find(outcome => outcome.kind === 'stopped')?.kind, 'stopped')
    assert.equal(progress.outcomes.find(outcome => outcome.kind === 'exited')?.kind, 'exited')
})

test('全部就绪后 UI 服务即使以零退出码结束仍属于意外故障', { timeout: 10000 }, async () => {
    const port = await freePort()
    const ui = `require('node:http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{"entry":"/src/App.sfa","modules":[{"url":"/src/App.sfa","source":"export default {}"}]}')}).listen(${port},'127.0.0.1');setTimeout(()=>process.exit(0),300)`
    const outcome = await new DevSupervisor(new Executor()).run([
        { name: 'ui', exitPolicy: 'service', command: process.execPath, args: ['-e', ui], readyUrl: `http://127.0.0.1:${port}`, readyCheck: async response => (await response.json() as { modules?: unknown[] }).modules?.length === 1 },
        { name: 'native', command: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], dependsOn: ['ui'] }
    ])
    assert.deepEqual(outcome, { kind: 'failed', exitCode: 1, message: 'ui 意外退出（退出码 0）' })
})

test("等待后续进程就绪时，已就绪进程退出会停止全部进程", { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-startup-failure-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const uiPort = await freePort()
    const nativePort = await freePort()
    const thirdMarker = join(directory, "third")
    const ui = `require('node:http').createServer((q,s)=>s.end('ok')).listen(${uiPort},'127.0.0.1');setTimeout(()=>process.exit(7),400)`
    const native = `require('node:http').createServer((q,s)=>{s.statusCode=503;s.end('preparing')}).listen(${nativePort},'127.0.0.1')`
    const startedAt = Date.now()
    await assert.rejects(new DevSupervisor(new Executor()).run([
        { name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${uiPort}` },
        { name: "native", command: process.execPath, args: ["-e", native], readyUrl: `http://127.0.0.1:${nativePort}`, dependsOn: ["ui"] },
        { name: "third", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(thirdMarker)},'wrong')`], dependsOn: ["native"] },
    ], { readinessTimeoutMs: 5000 }), /ui 在准备就绪前退出（7）/)
    assert.ok(Date.now() - startedAt < 3000)
    await assert.rejects(readFile(thirdMarker), /ENOENT/)
    await assert.rejects(fetch(`http://127.0.0.1:${uiPort}`))
    await assert.rejects(fetch(`http://127.0.0.1:${nativePort}`))
})

test("开发监管在取消后保留清理失败，并继续停止其余进程", async () => {
    class CleanupFailureExecutor extends Executor {
        started = 0
        readonly stopped: number[] = []
        override start(spec: ProcessSpec) {
            const child = super.start(spec)
            const ordinal = this.started++
            return {
                ...child, stop: async () => {
                    this.stopped.push(ordinal)
                    const verdict = await child.stop()
                    if (ordinal === 0) throw new Error("拒绝终止一个子进程")
                    return verdict
                }
            }
        }
    }
    const executor = new CleanupFailureExecutor()
    const signal = new AbortController()
    const running = new DevSupervisor(executor).run([
        { name: "ui", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] },
        { name: "native", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] },
    ], { signal: signal.signal })
    setTimeout(() => signal.abort(), 100)
    await assert.rejects(running, /开发进程清理失败.*拒绝终止/)
    assert.deepEqual(executor.stopped, [0, 1])
})

test('开发就绪失败后清理再失败时同时保留两种原因，进程仍被停止', async () => {
    const port = await freePort()
    const cleanup = new Error('清理确认失败')
    class FailureExecutor extends Executor {
        override start(spec: ProcessSpec) {
            const child = super.start(spec)
            return {
                ...child, stop: async () => {
                    await child.stop()
                    throw cleanup
                }
            }
        }
    }
    const source = "require('node:http').createServer((q,s)=>{s.statusCode=503;s.end('preparing')}).listen(" + port + ",'127.0.0.1')"
    await assert.rejects(new DevSupervisor(new FailureExecutor()).run([
        { name: 'ui', command: process.execPath, args: ['-e', source], readyUrl: 'http://127.0.0.1:' + port }
    ], { readinessTimeoutMs: 500 }), error => {
        assert.ok(error instanceof AggregateError)
        assert.match(error.message, /未在限定时间内就绪.*开发进程清理失败.*清理确认失败/)
        assert.equal(error.errors.length, 2)
        assert.strictEqual(error.errors[1].cause, cleanup)
        return true
    })
    await assert.rejects(fetch('http://127.0.0.1:' + port))
})

test("开发监管在启动原生进程前拒绝 HTTP 200 的 HTML 回退页", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-dev-fallback-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const port = await freePort()
    const marker = join(directory, "native-started")
    const ui = `require('node:http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<html>fallback</html>')}).listen(${port},'127.0.0.1')`
    const supervisor = new DevSupervisor(new Executor())
    await assert.rejects(supervisor.run([
        {
            name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${port}/@arrange/modules`, readyCheck: async response => {
                if (!response.headers.get("content-type")?.includes("application/json")) return false
                const body = await response.json() as { entry?: unknown, modules?: unknown[] }
                return typeof body.entry === "string" && Array.isArray(body.modules) && body.modules.length > 0
            }
        },
        { name: "native", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'wrong')`], dependsOn: ["ui"] },
    ], { readinessTimeoutMs: 400 }), /未在限定时间内就绪.*HTTP 200.*<html>fallback<\/html>/)
    await assert.rejects(readFile(marker), /ENOENT/)
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("开发服务就绪超时报告 HTTP 错误，正文首行长度受限", async () => {
    const port = await freePort()
    const ui = `require('node:http').createServer((q,s)=>{s.statusCode=500;s.end('Failed to load module: '+ 'x'.repeat(10000)+'\\nignored second line')}).listen(${port},'127.0.0.1')`
    await assert.rejects(new DevSupervisor(new Executor()).run([
        { name: "ui", command: process.execPath, args: ["-e", ui], readyUrl: `http://127.0.0.1:${port}/@arrange/modules` },
    ], { readinessTimeoutMs: 400 }), (error: Error) => {
        assert.match(error.message, /HTTP 500：Failed to load module:/)
        assert.equal(error.message.includes("ignored second line"), false)
        assert.ok(error.message.length < 650)
        return true
    })
    await assert.rejects(fetch(`http://127.0.0.1:${port}`))
})

test("Windows 命令与环境保留路径，并拒绝命令扩展字符", windowsOnly, () => {
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

test("本机真实工具发现：Node 与包管理器路径、版本及 Node 环境", async () => {
    const executor = new Executor()
    const state = stateFor(process.cwd())
    const node = process.execPath
    const { locateTool } = await import("../src/feature/platform/ToolLocator.ts")
    const npm = await locateTool("npm")
    assert.ok(npm, "需要本机 npm")
    state.local = { node: { path: node }, packageManager: { path: npm } }
    const inspection = await new ToolchainService(executor, createPlatformService(executor)).inspect(state, "UI")
    assert.deepEqual(inspection.issues, [])
    assert.equal(inspection.local.node!.path, node)
    assert.equal(satisfiesMinimumVersion(inspection.local.node!.version!, `${minimumNodeMajor}.0.0`), true)
    assert.ok(inspection.local.packageManager!.version)
})

test("Windows 真实 Developer Prompt 环境与 cl 架构一致", windowsOnly, async () => {
    const { local } = await nativeTools()
    const executor = new Executor()
    const platform = new WindowsPlatformService(executor)
    const env = await platform.nativeEnvironment(local)
    assert.ok(env.VCToolsInstallDir)
    const actual = await executor.run({ command: local.nativeCompiler!.path, args: [], env })
    assert.equal(parseMsvcArchitecture(actual.stdout + actual.stderr), hostArchitecture)
    const broken = structuredClone(local)
    broken.native!.developerCommand = "missing-vsdevcmd.bat"
    await assert.rejects(platform.nativeEnvironment(broken), /工具环境初始化失败/)
})

test("工具探测保留取消结果，不误报工具链问题", async () => {
    class CancelledExecutor extends Executor {
        override async run(): Promise<ProcessResult> {
            return { exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }
        }
    }
    const executor = new CancelledExecutor()
    const state = stateFor("/tmp/unused")
    state.local = { node: { path: process.execPath }, native: { generator: "Ninja", architecture: "x64" } }
    assert.throws(() => throwIfProcessCancelled({ exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }), isAbortError)
    await assert.rejects(new ToolchainService(executor, createPlatformService(executor)).inspect(state, "UI"), isAbortError)
    await assert.rejects(createPlatformService(executor).discoverNative(state.local), isAbortError)
})
