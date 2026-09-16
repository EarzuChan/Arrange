import {ProjectStateStore} from "../project/ProjectStateStore.ts"
import {FrameworkRegistryClient} from "../framework/FrameworkRegistryClient.ts"
import {assertFrameworkCompatible} from "../framework/FrameworkMamba.ts"
import type {ProjectState} from "../project/ProjectState.ts"
import {errorMessage} from "../util/Utils.ts"
import {SyncWizard} from "../wizard/config.ts"
import {ConfigScanner} from "./ConfigScanner.ts"
import {ConfigApplier} from "./ConfigApplier.ts"
import {ConfigResolver} from "./ConfigResolver.ts"
import type {ConfigScanReport} from "./ConfigScanReport.ts"

export interface SyncRunOptions {
    readonly scanOnly?: boolean
    readonly configOnly?: boolean
    readonly setupOnly?: boolean
    readonly uiOnly?: boolean
    readonly nativeOnly?: boolean
}

export interface SyncResult {readonly status: "completed" | "blocked" | "aborted" | "failed" | "setup-unavailable", readonly report?: ConfigScanReport}

async function checkCompatibility(state: ProjectState): Promise<void> {
    const candidate = await new FrameworkRegistryClient().fetchCandidateByVersion(state.project.framework.version, state.project.framework.nodeRegistryUrl ?? undefined)

    if (candidate.version !== state.project.framework.version) throw new Error("registry 返回的 Framework 版本与配置不符")
    assertFrameworkCompatible(candidate)
}

export class SyncService {
    readonly projectStateStore = new ProjectStateStore()
    readonly syncWizard = new SyncWizard()

    readonly configScanner = new ConfigScanner()
    readonly configApplier = new ConfigApplier()
    readonly configResolver = new ConfigResolver(this.syncWizard, this.configApplier.writer)

    async run(options: SyncRunOptions, rootDir: string): Promise<SyncResult> {
        if (options.configOnly && options.setupOnly) throw new Error("--config 与 --setup 互斥")
        if (options.uiOnly && options.nativeOnly) throw new Error("--ui 与 --native 互斥")

        const scope = options.uiOnly ? "UI" : options.nativeOnly ? "Native" : "Global"
        if (options.setupOnly) return this.runSetup(options, rootDir, scope)

        const configResult = await this.runConfig(options, rootDir, scope)
        if (options.configOnly || configResult.status !== "completed") return configResult

        return this.runSetup(options, rootDir, scope, configResult.report)
    }

    private async runConfig(options: SyncRunOptions, rootDir: string, scope: "Global" | "UI" | "Native"): Promise<SyncResult> {
        try {
            while (true) {
                const loaded = await this.projectStateStore.inspect(rootDir)

                // SCAN 阶段

                const report: ConfigScanReport = loaded.state ? await this.configScanner.scan(loaded.state, scope) : {scope, fatal: [], resolvable: [], idle: [], applicable: []}

                report.fatal.push(...loaded.errors.map(error => ({...error, cause: "config-invalid"})))

                if (loaded.state) try {
                    await checkCompatibility(loaded.state)
                } catch (error) {
                    report.fatal.push({path: "arrange.project.yaml", cause: "framework-incompatible", message: errorMessage(error)})
                }

                this.syncWizard.report(report)

                if (report.fatal.length) return {status: "blocked", report}
                if (options.scanOnly) {
                    if (report.resolvable.length) return {status: "blocked", report}
                    return {status: "completed", report}
                }

                if (!loaded.state) return {status: "blocked", report}

                // RESOLVE 阶段

                const resolved = await this.configResolver.resolve(loaded.state, report, loaded.snapshots)

                if (resolved === "abort") return {status: "aborted", report}
                if (resolved === "rescan") continue

                // APPLY 阶段
                await this.configApplier.apply(loaded.state.rootDir, report, loaded.snapshots)

                this.syncWizard.message("CONFIG 完成")
                return {status: "completed", report}
            }
        } catch (error) {
            this.syncWizard.message(errorMessage(error))
            return {status: "failed"}
        }
    }

    private runSetup(_options: SyncRunOptions, _rootDir: string, _scope: "Global" | "UI" | "Native", report?: ConfigScanReport): SyncResult {
        this.syncWizard.message("SETUP 尚未实现；可使用 sync --config 单独同步工程文件")
        return {status: "setup-unavailable", report}
    }
}
