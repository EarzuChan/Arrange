#!/usr/bin/env node
import { CommanderError } from "commander"
import { assertCliEnvironment } from "./CliEnvironment.ts"
import { isAbortError } from "./platform/ProcessSpec.ts"

const controller = new AbortController()
const interrupt = (): void => controller.abort()

try {
    assertCliEnvironment({ platform: process.platform, stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true })
    const { createCliApplication } = await import("./CliApplication.ts")
    const cli = createCliApplication({ signal: controller.signal, interactions: "terminal" })
    process.on("SIGINT", interrupt)
    process.on("SIGTERM", interrupt)
    cli.exitOverride()
    await cli.parseAsync(process.argv)
} catch (error) {
    if (error instanceof CommanderError) process.exitCode = error.exitCode
    else if (controller.signal.aborted && (error === controller.signal.reason || isAbortError(error))) {
        console.log("[ArrangeCLI]", error === controller.signal.reason ? "操作已取消" : `操作已取消：${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 130
    } else {
        console.error("[ArrangeCLI]", error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    }
} finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
}
