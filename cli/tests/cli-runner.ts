import { CommanderError } from "commander"
import { createCliApplication, type CliInteractions } from "../src/CliApplication.ts"
import { SyncWizard } from "../src/business/wizard/Sync.ts"
import { SetupWizard } from "../src/business/wizard/Setup.ts"
import { quietTerminal, OutputSink } from "./fixture.ts"
import { UserDirectories } from "../src/feature/user/UserDirectories.ts"
import { resolve } from "node:path"

// 程序化验收入口：输出走与正式入口相同的终端层，颜色遵循环境设置，任何需要询问的步骤直接失败
const output = new OutputSink()
const terminal = quietTerminal(output)
const config = new SyncWizard(terminal)
const setup = new SetupWizard(terminal)
const { reporter } = terminal
const ask = async (): Promise<never> => { throw new Error("需要交互：程序化验收不允许询问") }
const message = (value: string): void => reporter.step(value)
const failure = (value: string): void => reporter.error(value)
const interactions: CliInteractions = {
    project: { create: ask, adopt: ask, confirmInitialization: ask, confirm: ask, message, failure },
    config: { report: (report, options) => config.report(report, options), choose: ask, edit: ask, message, failure },
    setup: { report: (report, options) => setup.report(report, options), acceptTools: ask, editTools: ask, message, failure }
}

try {
    const cli = createCliApplication({ signal: new AbortController().signal, interactions, terminal, userDirectories: new UserDirectories(resolve(process.cwd(), "cli-test-user")) })
    cli.exitOverride()
    await cli.parseAsync(process.argv)
    process.exitCode = cli.resultCode
} catch (error) {
    if (error instanceof CommanderError) process.exitCode = error.exitCode
    else {
        reporter.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    }
} finally {
    await terminal.close()
    await new Promise<void>(resolve => { process.stdout.write(output.text, () => resolve()) })
}
