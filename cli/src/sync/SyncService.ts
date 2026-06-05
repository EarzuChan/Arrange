import { ProjectStateStore } from "../project/ProjectStateStore.ts"
import { SyncChecker } from "./SyncChecker.ts"
import { SyncPerformer } from "./SyncPerformer.ts"

export interface SyncRunOptions {
    readonly checkOnly?: boolean
    readonly projectOnly?: boolean
    readonly toolchainOnly?: boolean
    readonly uiOnly?: boolean
    readonly nativeOnly?: boolean
    readonly rootDir?: string
}

export class SyncService {
    constructor(private readonly projectStateStore: ProjectStateStore, private readonly checker: SyncChecker, private readonly performer: SyncPerformer,) {}

    async run(options: SyncRunOptions = {}): Promise<void> {
        const rootDir = options.rootDir ?? process.cwd()
        const state = await this.projectStateStore.load(rootDir)
        const context = { rootDir, state }
        const report = await this.checker.check(context)

        if (options.checkOnly) {
            if (!report.ok) throw new Error("Project sync check failed")
            return
        }

        await this.performer.perform(context, report)
        await this.projectStateStore.save(rootDir, context.state)
    }
}
