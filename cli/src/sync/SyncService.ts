import type {ProjectStateStore} from "../project/ProjectStateStore.ts"
import {SyncWizard} from "../wizard/Sync.ts"
import type {FrameworkRegistryClient} from "../framework/FrameworkRegistryClient.ts"
import {assertFrameworkCompatible} from "../framework/FrameworkMamba.ts"
import type {ProjectState} from "../project/ProjectState.ts"
import {errorMessage} from "../util/Utils.ts"
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

export interface SyncResult {
    readonly status: "completed" | "blocked" | "aborted" | "failed" | "setup-unavailable",
    readonly report?: ConfigScanReport
}

export class SyncService {
    private readonly configScanner = new ConfigScanner()
    private readonly configApplier = new ConfigApplier()
    private readonly syncWizard: SyncWizard = new SyncWizard()
    private readonly configResolver: ConfigResolver = new ConfigResolver(this.syncWizard)

    constructor(private readonly projectStateStore: ProjectStateStore, private readonly registryClient: FrameworkRegistryClient) {}

    private async checkCompatibility(state: ProjectState): Promise<void> {
        const candidate = await this.registryClient.fetchCandidateByVersion(state.project.framework.version, state.project.framework.nodeRegistryUrl ?? undefined)
        if (candidate.version !== state.project.framework.version) throw new Error("registry 返回的 Framework 版本与配置不符")
        assertFrameworkCompatible(candidate)
    }

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
                // 深度加载状态和校验阶段

                const loadedStuff = await this.projectStateStore.deepLoad(rootDir)
                const state = loadedStuff.state

                if (!state) {
                    const report: ConfigScanReport = {scope, fatal: loadedStuff.errors.map(error => ({...error, cause: "config-invalid"})), resolvable: [], idle: [], applicable: []}

                    this.syncWizard.report(report)
                    return {status: "blocked", report}
                }

                // 扫描阶段

                const report = await this.configScanner.scan(state, scope)

                report.fatal.push(...loadedStuff.errors.map(error => ({...error, cause: "config-invalid"})))

                try {
                    await this.checkCompatibility(state)
                } catch (error) {
                    report.fatal.push({path: "arrange.project.yaml", cause: "framework-incompatible", message: errorMessage(error)})
                }

                this.syncWizard.report(report)

                if (report.fatal.length) return {status: "blocked", report}

                if (options.scanOnly) return {status: report.resolvable.length ? "blocked" : "completed", report}

                // RESOLVE 阶段

                const resolved = await this.configResolver.resolve(state, report, loadedStuff.snapshots)

                if (resolved === "abort") return {status: "aborted", report}
                if (resolved === "rescan") continue

                // APPLY 阶段

                await this.configApplier.apply(state.rootDir, report, loadedStuff.snapshots)

                // 完成

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
