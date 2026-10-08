import { CommanderError } from "commander"
import { createCliApplication, type CliInteractions } from "../src/CliApplication.ts"
import { SyncWizard } from "../src/wizard/Sync.ts"
import { SetupWizard } from "../src/wizard/Setup.ts"

const config = new SyncWizard()
const setup = new SetupWizard()
const ask = async (): Promise<never> => { throw new Error("需要交互：程序化验收不允许询问") }
const message = (value: string): void => console.log("[ArrangeCLI]", value)
const failure = (value: string): void => console.error("[ArrangeCLI]", value)
const interactions: CliInteractions = {
    project: { create: ask, adopt: ask, confirmInitialization: ask, confirm: ask, message, failure },
    config: { report: report => config.report(report), choose: ask, edit: ask, message, failure },
    setup: { report: report => setup.report(report), acceptTools: ask, editTools: ask, message, failure }
}

try {
    const cli = createCliApplication({ signal: new AbortController().signal, interactions })
    cli.exitOverride()
    await cli.parseAsync(process.argv)
} catch (error) {
    if (error instanceof CommanderError) process.exitCode = error.exitCode
    else {
        failure(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    }
}
