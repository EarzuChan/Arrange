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
    constructor(private readonly projectStateStore: ProjectStateStore, private readonly configChecker: ConfigChecker, private readonly configPerformer: ConfigPerformer,) {
    }

    // SYNC分为：
    // 二阶段：CHECK、PERFORM
    // 二类型：CONFIG（配置项的没毛病）、SETUP（工具链的已准备妥当）
    async run(options: SyncRunOptions): Promise<void> {
        void options

        const rootDir = process.cwd()
        const state = await this.projectStateStore.load(rootDir)
        const context = {rootDir, state}

        // CHECK
        const configCheckReport = await this.configChecker.check(context)
        // TODO：这是远期占位符，之后的Setup Check

        // CONFIG 的阐述这一块
        if (hasConfigProblems(configCheckReport)) {
            // TODO：具体阐述问题并停止
        } else console.log("SYNC: CONFIG check: ok.")

        // TODO：SETUP 的阐述这一块

        if (options.checkOnly) return

        await this.configPerformer.perform(context, configCheckReport)
        // TODO：这是远期占位符，之后的Setup Perform

        console.log("SYNC: ALL DONE.")
    }
}
