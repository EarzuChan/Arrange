import { ProjectStateStore } from "../project/ProjectStateStore.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NodeJsService } from "../node-js/NodeJsService.ts"
import { CmakeService } from "../cmake/CmakeService.ts"
import { FrameworkService } from "../framework/FrameworkService.ts"
import type { SetupInteraction } from "./SetupInteraction.ts"
import { assertSnapshots } from "../util/FileUtils.ts"
import { errorMessage } from "../util/Utils.ts"
import type { SetupScanReport, SetupScope, SetupResult, SetupTask } from "./SetupScanReport.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export class SetupService {
    constructor(private readonly store: ProjectStateStore, private readonly tools: ToolchainService, private readonly node: NodeJsService, private readonly cmake: CmakeService, private readonly framework: FrameworkService, private readonly interaction: SetupInteraction, private readonly signal: AbortSignal) { }

    async scan(rootDir: string, scope: SetupScope): Promise<SetupScanReport> {
        this.signal.throwIfAborted()
        const loaded = await this.store.deepLoad(rootDir)
        const fatal = loaded.errors.map(issue => ({ key: issue.path, message: issue.message }))
        const resolvable: { key: string, message: string }[] = []
        const idle: string[] = []
        const applicable: SetupTask[] = []
        const state = loaded.state
        if (!state) return { scope, state, snapshots: loaded.snapshots, proposedLocal: null, fatal, resolvable, idle, applicable }
        try { await this.framework.assertCompatible(state, "remote") } catch (error) {
            if (isAbortError(error)) throw error
            fatal.push({ key: "framework", message: errorMessage(error) })
        }
        const inspected = await this.tools.inspect(state, scope)
        this.signal.throwIfAborted()
        const proposedLocal = inspected.local
        resolvable.push(...inspected.issues.map(issue => ({ key: issue.key, message: issue.message })))
        if (!resolvable.length && JSON.stringify(state.local) !== JSON.stringify(proposedLocal)) resolvable.push({ key: "local-tools", message: "检测到了尚未保存或版本已变化的本机工具，需要确认" })
        if (!resolvable.length) idle.push("本机工具链")
        const preparedState = { ...state, local: proposedLocal }
        if (scope !== "Native") {
            const result = await this.node.inspect(preparedState)
            if (result.ready) idle.push("UI 依赖")
            else if (result.fatal) fatal.push({ key: "ui", message: result.reason ?? "UI 工程不可用" })
            else applicable.push({ kind: "install-ui", reason: result.reason })
        }
        if (scope !== "UI" && !inspected.issues.length) {
            for (const flavor of ["debug", "release"] as const) {
                const result = await this.cmake.inspect(preparedState, flavor)
                if (result.ready) idle.push(`native ${flavor}`)
                else applicable.push({ kind: "configure-native", flavor })
            }
        }
        return { scope, state, snapshots: loaded.snapshots, proposedLocal, fatal, resolvable, idle, applicable }
    }

    async run(rootDir: string, scope: SetupScope, scanOnly = false): Promise<SetupResult> {
        try {
            while (true) {
                this.signal.throwIfAborted()
                const report = await this.scan(rootDir, scope)
                this.interaction.report(report)
                this.signal.throwIfAborted()
                if (report.fatal.length) return { status: "blocked", report }
                if (scanOnly) return { status: report.resolvable.length || report.applicable.length ? "blocked" : "completed", report }
                if (report.resolvable.length) {
                    const issue = report.resolvable[0]
                    if (issue.key === "local-tools" && report.proposedLocal) {
                        const accepted = await this.interaction.acceptTools(report.proposedLocal)
                        this.signal.throwIfAborted()
                        if (!accepted) return { status: "aborted", report }
                        await this.store.saveLocal(rootDir, report.proposedLocal, report.snapshots)
                    } else {
                        const edited = await this.interaction.editTools(issue.message)
                        this.signal.throwIfAborted()
                        if (!edited) return { status: "aborted", report }
                    }
                    continue
                }
                if (!report.state) return { status: "blocked", report }
                await assertSnapshots(report.snapshots)
                for (const task of report.applicable) {
                    this.signal.throwIfAborted()
                    await assertSnapshots(report.snapshots)
                    this.signal.throwIfAborted()
                    if (task.kind === "install-ui") await this.node.install(report.state)
                    else await this.cmake.configure(report.state, task.flavor)
                }
                this.interaction.message("SETUP 完成")
                return { status: "completed", report }
            }
        } catch (error) {
            if (isAbortError(error)) throw error
            this.interaction.failure(`SETUP 失败：${errorMessage(error)}`)
            return { status: "failed" }
        }
    }
}
