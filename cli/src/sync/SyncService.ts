import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import type { FrameworkService } from "../framework/FrameworkService.ts"
import { errorMessage } from "../util/Utils.ts"
import { ConfigScanner } from "./ConfigScanner.ts"
import { ConfigApplier } from "./ConfigApplier.ts"
import { ConfigResolver } from "./ConfigResolver.ts"
import type { ConfigScanReport } from "./ConfigScanReport.ts"
import type { SetupService } from "./SetupService.ts"
import type { SetupScanReport } from "./SetupScanReport.ts"
import type { ConfigInteraction } from "./ConfigInteraction.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export interface SyncRunOptions {
    readonly scanOnly?: boolean
    readonly configOnly?: boolean
    readonly setupOnly?: boolean
    readonly uiOnly?: boolean
    readonly nativeOnly?: boolean
}

export interface SyncResult {
    readonly status: "completed" | "blocked" | "aborted" | "failed",
    readonly report?: ConfigScanReport
    readonly setupReport?: SetupScanReport
}

export class SyncService {
    constructor(private readonly projectStateStore: ProjectStateStore, private readonly framework: FrameworkService, private readonly configScanner: ConfigScanner, private readonly configResolver: ConfigResolver, private readonly configApplier: ConfigApplier, private readonly setupService: Pick<SetupService, "run">, private readonly interaction: ConfigInteraction, private readonly signal: AbortSignal) { }

    async run(options: SyncRunOptions, rootDir: string): Promise<SyncResult> {
        this.signal.throwIfAborted()
        if (options.configOnly && options.setupOnly) throw new Error("--config 与 --setup 互斥")
        if (options.uiOnly && options.nativeOnly) throw new Error("--ui 与 --native 互斥")

        const scope = options.uiOnly ? "UI" : options.nativeOnly ? "Native" : "Global"
        if (options.setupOnly) return this.runSetup(options, rootDir, scope)

        const configResult = await this.runConfig(options, rootDir, scope)
        if (options.scanOnly && !options.configOnly) {
            const setupResult = await this.runSetup(options, rootDir, scope, configResult.report)
            return { ...setupResult, status: configResult.status === "completed" ? setupResult.status : configResult.status }
        }
        if (options.configOnly || configResult.status !== "completed") return configResult

        return this.runSetup(options, rootDir, scope, configResult.report)
    }

    private async runConfig(options: SyncRunOptions, rootDir: string, scope: "Global" | "UI" | "Native"): Promise<SyncResult> {
        try {
            while (true) {
                this.signal.throwIfAborted()
                // 深度加载状态和校验阶段

                const loadedStuff = await this.projectStateStore.deepLoad(rootDir)
                const state = loadedStuff.state

                if (!state) {
                    const report: ConfigScanReport = { scope, fatal: loadedStuff.errors.map(error => ({ ...error, cause: "config-invalid" })), resolvable: [], idle: [], applicable: [] }

                    this.interaction.report(report)
                    return { status: "blocked", report }
                }

                // 扫描阶段

                const report = await this.configScanner.scan(state, scope)

                report.fatal.push(...loadedStuff.errors.map(error => ({ ...error, cause: "config-invalid" })))

                try {
                    await this.framework.assertCompatible(state, "remote")
                } catch (error) {
                    if (isAbortError(error)) throw error
                    report.fatal.push({ path: "arrange.project.yaml", cause: "framework-incompatible", message: errorMessage(error) })
                }

                this.interaction.report(report)
                this.signal.throwIfAborted()

                if (report.fatal.length) return { status: "blocked", report }

                if (options.scanOnly) return { status: report.resolvable.length ? "blocked" : "completed", report }

                // RESOLVE 阶段

                const resolved = await this.configResolver.resolve(state, report, loadedStuff.snapshots)
                this.signal.throwIfAborted()

                if (resolved === "abort") return { status: "aborted", report }
                if (resolved === "rescan") continue

                // APPLY 阶段

                await this.configApplier.apply(state.rootDir, report, loadedStuff.snapshots)

                // 完成

                this.interaction.message("CONFIG 完成")
                return { status: "completed", report }
            }
        } catch (error) {
            if (isAbortError(error)) throw error
            this.interaction.failure(`CONFIG 失败：${errorMessage(error)}`)
            return { status: "failed" }
        }
    }

    private async runSetup(options: SyncRunOptions, rootDir: string, scope: "Global" | "UI" | "Native", report?: ConfigScanReport): Promise<SyncResult> {
        this.signal.throwIfAborted()
        const result = await this.setupService.run(rootDir, scope, options.scanOnly)
        return { status: result.status, report, setupReport: result.report }
    }
}
