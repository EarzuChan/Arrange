#!/usr/bin/env node
import { CommanderError } from 'commander'
import { assertCliEnvironment } from './util/CliEnvironment.ts'
import { TerminalSession } from './terminal/TerminalSession.ts'
import { commandInterface } from './business/CommandInterface.ts'

const session = new TerminalSession()

try {
    assertCliEnvironment({ platform: process.platform, stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true })

    process.exitCode = await session.run(async (ui, signal) => {
        // 环境闸门通过后再加载完整服务装配图
        const { createCliApplication } = await import('./CliApplication.ts')

        const terminal = commandInterface(ui, signal)

        const cli = createCliApplication({ signal, interactions: 'terminal', terminal })

        try {
            await cli.parseAsync(process.argv)
        }
        catch (error) {
            if (error instanceof CommanderError) return error.exitCode
            throw error
        }

        return cli.resultCode
    })
} catch (error) {
    session.ui.reporter.fail(error instanceof Error ? error.message : String(error))

    process.exitCode = 1

    await session.close()
}
