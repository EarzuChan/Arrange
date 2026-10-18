#!/usr/bin/env node
import { runTerminal } from './tui/index.ts'
import { runDemo } from './app.ts'

try {
    process.exitCode = await runTerminal(runDemo)
} catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exitCode = 1
}
