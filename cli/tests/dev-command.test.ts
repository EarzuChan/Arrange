import assert from "node:assert/strict"
import test from "node:test"
import { Command } from "commander"
import { registerDevCommand } from "../src/command/Dev.ts"
import type { DevService } from "../src/building/DevService.ts"

test("dev command preserves cleanup failures after Ctrl+C and accepts only actual cancellation", async () => {
    const previousExitCode = process.exitCode
    try {
        const controller = new AbortController()
        controller.abort()
        const cleanupFailure = new Error("开发进程清理失败：权限不足")
        const failed = new Command().exitOverride()
        registerDevCommand(failed, { run: async () => { throw cleanupFailure } } as unknown as DevService, controller.signal)
        process.exitCode = 9
        await assert.rejects(failed.parseAsync(["node", "arrange", "dev"]), error => error === cleanupFailure)
        assert.equal(process.exitCode, 9)

        const cancelled = new Command().exitOverride()
        registerDevCommand(cancelled, { run: async () => { throw controller.signal.reason } } as unknown as DevService, controller.signal)
        await cancelled.parseAsync(["node", "arrange", "dev"])
        assert.equal(process.exitCode, 0)

        const active = new Command().exitOverride()
        registerDevCommand(active, { run: async () => { throw new DOMException("操作已取消", "AbortError") } } as unknown as DevService, new AbortController().signal)
        await assert.rejects(active.parseAsync(["node", "arrange", "dev"]), { name: "AbortError" })
    } finally { process.exitCode = previousExitCode }
})
