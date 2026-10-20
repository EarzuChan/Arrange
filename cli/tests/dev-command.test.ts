import assert from "node:assert/strict"
import test from "node:test"
import { ApplicationCommand } from "../src/business/ApplicationCommand.ts"
import { registerDevCommand } from "../src/business/command/Dev.ts"
import type { DevService } from "../src/feature/building/DevService.ts"
import type { CommandInterface } from '../src/business/CommandInterface.ts'
import { quietTerminal } from "./fixture.ts"

test("dev 在 Ctrl+C 后保留清理失败，只把真正取消识别为取消", async t => {
    const previousExitCode = process.exitCode
    const terminal = quietTerminal()
    t.after(() => terminal.close())
    const controller = new AbortController()
    controller.abort()
    const cleanupFailure = new Error("开发进程清理失败：权限不足")
    const failed = new ApplicationCommand({ close: async () => { } }).exitOverride()
    registerDevCommand(failed, { run: async () => { throw cleanupFailure } } as unknown as DevService, controller.signal, { reporter: terminal.reporter, stoppable: async (_hint, body) => body({ signal: new AbortController().signal, enable() { }, disable() { } }) })
    await assert.rejects(failed.parseAsync(["node", "arrange", "dev"]), error => error === cleanupFailure)
    assert.equal(process.exitCode, previousExitCode)

    const cancelled = new ApplicationCommand({ close: async () => { } }).exitOverride()
    registerDevCommand(cancelled, { run: async () => { throw controller.signal.reason } } as unknown as DevService, controller.signal, { reporter: terminal.reporter, stoppable: async (_hint, body) => body({ signal: new AbortController().signal, enable() { }, disable() { } }) })
    await cancelled.parseAsync(["node", "arrange", "dev"])
    assert.equal(cancelled.resultCode, 130)
    assert.equal(process.exitCode, previousExitCode)

    const active = new ApplicationCommand({ close: async () => { } }).exitOverride()
    registerDevCommand(active, { run: async () => { throw new DOMException("操作已取消", "AbortError") } } as unknown as DevService, new AbortController().signal, { reporter: terminal.reporter, stoppable: async (_hint, body) => body({ signal: new AbortController().signal, enable() { }, disable() { } }) })
    await assert.rejects(active.parseAsync(["node", "arrange", "dev"]), { name: "AbortError" })
})

test("dev 将实际退出码返回应用，不修改宿主进程状态", async t => {
    const previousExitCode = process.exitCode
    const terminal = quietTerminal()
    t.after(() => terminal.close())
    const command = new ApplicationCommand({ close: async () => { } }).exitOverride()
    registerDevCommand(command, { run: async () => ({ kind: 'failed', exitCode: 7, message: '开发会话异常结束（退出码 7）' }) }, new AbortController().signal, { reporter: terminal.reporter, stoppable: async (_hint, body) => body({ signal: new AbortController().signal, enable() { }, disable() { } }) })
    await command.parseAsync(["node", "arrange", "dev"])
    assert.equal(command.resultCode, 7)
    assert.equal(process.exitCode, previousExitCode)
    await terminal.close()
    assert.match(terminal.output.text, /开发会话异常结束（退出码 7）/)
})
