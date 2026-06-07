import type {ProjectStateStore} from "../project/ProjectStateStore.ts"
import {hasConfigProblems} from "./ConfigReport.ts"
import {ConfigChecker} from "./ConfigChecker.ts"
import {ConfigPerformer} from "./ConfigPerformer.ts"

export interface SyncRunOptions {
    readonly checkOnly: boolean
    readonly projectOnly: boolean
    readonly toolchainOnly: boolean
    readonly uiOnly: boolean
    readonly nativeOnly: boolean
}

export class SyncService {
    constructor(private readonly projectStateStore: ProjectStateStore, private readonly configChecker: ConfigChecker, private readonly configPerformer: ConfigPerformer,) {}

    async run(options: SyncRunOptions): Promise<void> {
        void options

        const rootDir = process.cwd()
        const state = await this.projectStateStore.load(rootDir)
        const context = {rootDir, state}
        const report = await this.configChecker.check(context)

        if (options.checkOnly) {
            if (hasConfigProblems(report)) {
                console.error("Project sync check: updates are needed.")
                process.exitCode = 1 // HACK：不应由这里直接退出程序
            } else console.log("Project sync check: ok.")

            // TODO：这是远期占位符，之后的Setup Check

            return
        }

        await this.configPerformer.perform(context, report)

        // TODO：这是远期占位符，之后的Setup Perform

        console.log("Project config synced.")
    }
}
