import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"
import test, { type TestContext } from "node:test"
import { OperationHost, type AcquisitionOptions } from "../src/operation/OperationHost.ts"
import { Operations } from "../src/operation/Operations.ts"
import { canonicalResource, resourcesConflict, type Resource } from "../src/operation/Resource.ts"
import { UserDirectories } from "../src/user/UserDirectories.ts"
import { KernelLock } from "../src/operation/KernelLock.ts"
import { isAbortError } from "../src/platform/ProcessSpec.ts"
import { write } from "./fixture.ts"

async function harness(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "arrange-operation-"))
    const user = new UserDirectories(join(root, "user"))
    const hosts: OperationHost[] = []
    const children: ChildProcess[] = []
    const host = () => {
        const host = new OperationHost(user)
        hosts.push(host)
        return host
    }
    t.after(async () => {
        for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill()
        await Promise.allSettled(hosts.map(host => host.close()))
        await rm(root, { recursive: true, force: true })
    })
    const resource: Resource = { kind: "directory", path: join(root, "build"), mode: "write" }
    return { root, user, host, hosts, resource, children }
}

test("内核锁不因时间推移转移，关闭句柄后允许下一持有者", async t => {
    const input = await harness(t)
    const kernel = new KernelLock()
    const path = join(input.root, "probe.kernel")
    const first = kernel.tryAcquire(path)!
    assert.equal(kernel.tryAcquire(path), undefined)
    await delay(150)
    assert.equal(kernel.tryAcquire(path), undefined)
    first.close()
    kernel.tryAcquire(path)!.close()
})

test("路径别名和 Windows 大小写共享资源身份，嵌套目录冲突，独立目录不冲突", async t => {
    const input = await harness(t)
    await write(join(input.root, "real", "keep"), "x")
    await symlink(join(input.root, "real"), join(input.root, "alias"), process.platform === "win32" ? "junction" : "dir")
    const first = await canonicalResource({ ...input.resource, path: join(input.root, "real", "new") })
    const alias = await canonicalResource({ ...input.resource, path: join(input.root, "alias", "new") })
    assert.deepEqual(first, alias)
    if (process.platform === "win32") assert.deepEqual(first, await canonicalResource({ ...first, path: first.path.toUpperCase() }))
    assert.equal(resourcesConflict(first, { ...first, path: join(first.path, "child") }), true)
    assert.equal(resourcesConflict(first, { ...first, path: `${first.path}-different` }), false)
    assert.equal(resourcesConflict({ ...first, mode: "read" }, { ...first, mode: "read" }), false)
})

test("整组授予、共享读取与写者公平排队；等待取消不影响持有者", async t => {
    const input = await harness(t)
    const first = input.host()
    const writer = input.host()
    const later = input.host()
    const signal = new AbortController().signal
    const read = { ...input.resource, mode: "read" as const }
    const releaseFirst = await first.acquire([read], "pack", signal, () => { })
    let waited!: () => void
    const waiting = new Promise<void>(resolve => { waited = resolve })
    const pendingWriter = writer.acquire([input.resource, { ...input.resource, path: join(input.root, "other") }], "build", signal, () => waited())
    await waiting
    // 等待者尚未占用第二个资源
    const releaseOther = await later.acquire([{ ...input.resource, path: join(input.root, "other") }], "independent", signal, () => { }, { observe: true }).catch(error => {
        assert.match(error.message, /资源正在使用/)
        return undefined
    })
    await releaseOther?.()
    const cancelled = new AbortController()
    const waitingReader = later.acquire([read], "later pack", cancelled.signal, () => { })
    setTimeout(() => cancelled.abort(), 50)
    await assert.rejects(waitingReader, isAbortError)
    await releaseFirst()
    const releaseWriter = await pendingWriter
    const probe = new AbortController()
    const blocked = first.acquire([read], "read", probe.signal, () => { })
    setTimeout(() => probe.abort(), 50)
    await assert.rejects(blocked, isAbortError)
    await releaseWriter()
    const release = await first.acquire([read], "read", signal, () => { })
    await release()
})

test("同配置串行、debug/release 并行，观察忙资源立即返回，不升级嵌套占用", async t => {
    const input = await harness(t)
    const first = input.host()
    const second = input.host()
    const signal = new AbortController().signal
    const debug = { ...input.resource, path: join(input.resource.path, "xd") }
    const release = { ...input.resource, path: join(input.resource.path, "xr") }
    const unlockDebug = await first.acquire([debug], "build debug", signal, () => { })
    const unlockRelease = await second.acquire([release], "build release", signal, () => { })
    await assert.rejects(second.acquire([debug], "scan", signal, () => { }, { observe: true }), /无法稳定扫描/)
    await unlockRelease()
    await unlockDebug()
    const operations = new Operations(first, signal, () => { })
    await operations.run([debug], "outer", async () => {
        await operations.run([debug], "covered", async () => { })
        await assert.rejects(operations.run([release], "upgrade", async () => { }), /未规划的资源/)
    })
})

test("依赖源码锁不设等待期限，普通占用保留期限；等待取消不释放持有者", { timeout: 15000 }, async t => {
    const input = await harness(t)
    const holder = input.host()
    const waiter = new class extends OperationHost {
        override acquire(resources: readonly Resource[], label: string, signal: AbortSignal, waiting: (message: string) => void, options: AcquisitionOptions = {}) {
            return super.acquire(resources, label, signal, waiting, { timeoutMs: 50, ...options })
        }
    }(input.user)
    input.hosts.push(waiter)
    const source = await canonicalResource({ kind: "source", path: join(input.root, "request"), mode: "write" })
    const controller = new AbortController()
    const release = await holder.acquire([source], "获取依赖源码夹具", controller.signal, () => { })
    let onWaiting!: () => void
    const waiting = new Promise<void>(resolve => { onWaiting = resolve })
    const operations = new Operations(waiter, controller.signal, () => onWaiting())
    let entered = false
    const pending = operations.source(source.path, "等待依赖源码夹具", async () => { entered = true })
    await waiting
    await assert.rejects(waiter.acquire([source], "有限等待夹具", controller.signal, () => { }), /等待资源超过/)
    assert.equal(entered, false)
    await release()
    await pending
    assert.equal(entered, true)

    const releaseAgain = await holder.acquire([source], "再次持有依赖源码夹具", controller.signal, () => { })
    const waitingAgain = new Promise<void>(resolve => { onWaiting = resolve })
    const cancelled = assert.rejects(operations.source(source.path, "取消源码等待夹具", async () => assert.fail("取消等待后不得执行")), isAbortError)
    await waitingAgain
    controller.abort()
    await cancelled
    await assert.rejects(waiter.acquire([source], "检查原持有者", new AbortController().signal, () => { }, { observe: true }), /无法稳定扫描/)
    await releaseAgain()
    const releaseAfterCancel = await waiter.acquire([source], "取消后重新获取", new AbortController().signal, () => { })
    await releaseAfterCancel()
})

test("正式工作进程托管输出、超时与取消，并在释放前结束工具", async t => {
    const input = await harness(t)
    const host = input.host()
    let output = ""
    const result = await host.start({ command: process.execPath, args: ["-e", "process.stdout.write('你好');process.stderr.write('error')"], onOutput: chunk => { output += chunk.toString() } }).completion
    assert.equal(result.exitCode, 0)
    assert.match(output, /你好/)
    assert.equal(result.stderr, "error")
    await assert.rejects(host.start({ command: join(input.root, "missing-command"), args: [] }).completion, /ENOENT/)
    const timed = await host.start({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], timeoutMs: 100 }).completion
    assert.equal(timed.timedOut, true)
    const controller = new AbortController()
    const child = host.start({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    assert.equal((await child.completion).cancelled, true)
    const immediate = host.start({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] })
    await immediate.stop()
    assert.equal((await immediate.completion).cancelled, true)
})

test("父进程正常退出后结束后代，PID 从完整标准输出读取", async t => {
    const input = await harness(t)
    const host = input.host()
    const result = await host.start({ command: process.execPath, args: ["-e", "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(c.pid)+'\\n');c.unref()"] }).completion
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(result.stdout, /^[1-9]\d*\n$/)
    const descendant = Number(result.stdout)
    assert.ok(Number.isSafeInteger(descendant) && descendant > 0)
    assert.throws(() => process.kill(descendant, 0), /ESRCH|no such process/i)
})

test("客户端被强杀后，工作进程先停止工具和后代，再允许接管资源", async t => {
    const input = await harness(t)
    const client = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(import.meta.dirname, "fixtures", "operation-client.ts"), input.user.root, input.resource.path, "tool"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    input.children.push(client)
    let text = ""
    client.stdout!.on("data", chunk => { text += chunk.toString() })
    for (let count = 0; !text.includes("READY") && count < 100; count++) await delay(50)
    assert.match(text, /READY/)
    const pids = text.match(/TOOL (\d+) (\d+)/)!
    assert.ok(pids)
    client.kill("SIGKILL")
    await once(client, "exit")
    const host = input.host()
    const release = await host.acquire([input.resource], "retry", new AbortController().signal, () => { })
    for (const pid of pids.slice(1).map(Number)) assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/i)
    await release()
})

test("工作进程死亡但客户端仍存活时拒绝接管；两者结束后恢复", async t => {
    const input = await harness(t)
    const client = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(import.meta.dirname, "fixtures", "operation-client.ts"), input.user.root, input.resource.path, "hold"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    input.children.push(client)
    let text = ""
    client.stdout!.on("data", chunk => { text += chunk.toString() })
    for (let count = 0; !text.includes("READY") && count < 100; count++) await delay(50)
    assert.match(text, /READY/)
    const records = (await readdir(input.user.operations)).filter(name => name.endsWith(".json"))
    const record = JSON.parse(await readFile(join(input.user.operations, records[0]!), "utf8"))
    process.kill(record.worker, "SIGKILL")
    const host = input.host()
    await delay(100)
    await assert.rejects(host.acquire([input.resource], "observe", new AbortController().signal, () => { }, { observe: true }), /资源正在使用/)
    client.kill("SIGKILL")
    await once(client, "exit")
    const release = await host.acquire([input.resource], "retry", new AbortController().signal, () => { })
    await release()
})
