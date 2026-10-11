#!/usr/bin/env node
import { CommanderError } from "commander"
import { assertCliEnvironment } from "./CliEnvironment.ts"
import { isAbortError } from "./platform/ProcessSpec.ts"
import { createTerminal } from "./ui/Terminal.ts"

const controller = new AbortController()
// 进程的标准输入输出是唯一的终端：应用装配与入口的错误输出共用它
const terminal = createTerminal()
const interrupt = (): void => controller.abort()

try {
    assertCliEnvironment({ platform: process.platform, stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true })

    const { createCliApplication } = await import("./CliApplication.ts")

    const cli = createCliApplication({ signal: controller.signal, interactions: "terminal", terminal })

    process.on("SIGINT", interrupt)
    process.on("SIGTERM", interrupt)

    cli.exitOverride()

    await cli.parseAsync(process.argv)
} catch (error) {
    if (error instanceof CommanderError) process.exitCode = error.exitCode
    else if (controller.signal.aborted && (error === controller.signal.reason || isAbortError(error))) {
        const detail = error === controller.signal.reason ? "" : error instanceof Error ? error.message : String(error)
        terminal.reporter.cancelled(detail && detail !== "操作已取消" ? `操作已取消：${detail}` : "操作已取消")
        process.exitCode = 130
    } else {
        terminal.reporter.fail(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    }
} finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
}

// 命令已结束：恢复终端输入模式，等输出写完后明确结束进程，不依赖其余句柄自然关闭
terminal.close()

await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(resolve => stream.write("", () => resolve()))))

process.exit(process.exitCode ?? 0)
