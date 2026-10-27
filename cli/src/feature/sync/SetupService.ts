import { ProjectStateStore } from "../project/ProjectStateStore.ts"
import { ToolchainService } from "../platform/ToolchainService.ts"
import { NodeJsService } from "../nodejs/NodeJsService.ts"
import { CmakeService } from "../cmake/CmakeService.ts"
import { FrameworkService } from "../framework/FrameworkService.ts"
import { frameworkSourceProblem, type FrameworkSourceProbe } from "../framework/FrameworkSourceProbe.ts"
import { localFrameworkOriginProblem } from "../framework/FrameworkOrigin.ts"
import type { SetupInteraction } from "./SetupInteraction.ts"
import { assertSnapshots } from "../../util/FileUtils.ts"
import { errorMessage } from "../../util/Utils.ts"
import type { SetupScanReport, SetupScope, SetupResult, SetupTask } from "./SetupScanReport.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"
import type { TaskEntry, TaskRunner } from "../operation/Work.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { ResourcePlanChanged } from "../../util/ResourcePlanChanged.ts"

export class SetupService {
    constructor(private readonly store: ProjectStateStore, private readonly tools: ToolchainService, private readonly node: NodeJsService, private readonly cmake: CmakeService, private readonly framework: FrameworkService, private readonly interaction: SetupInteraction, private readonly tasks: TaskRunner, private readonly signal: AbortSignal, private readonly source?: FrameworkSourceProbe, private readonly beforeApply?: (state: ProjectState, scope: SetupScope) => Promise<void>) { }

    async scan(rootDir: string, scope: SetupScope): Promise<SetupScanReport> {
        this.signal.throwIfAborted()
        const loaded = await this.store.deepLoad(rootDir)
        const fatal = loaded.errors.map(issue => ({ key: issue.path, message: issue.message }))
        const resolvable: { key: string, message: string }[] = []
        const idle: string[] = []
        const applicable: SetupTask[] = []
        const state = loaded.state
        if (!state) return { scope, state, snapshots: loaded.snapshots, proposedLocal: null, fatal, resolvable, idle, applicable }
        try { await this.framework.assertCompatible(state, "installed-first") } catch (error) {
            if (isAbortError(error)) throw error
            fatal.push({ key: "framework", message: errorMessage(error) })
        }
        const originProblem = localFrameworkOriginProblem(state)
        if (originProblem) fatal.push({ key: "framework-origin", message: originProblem })
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
            // 要配置构建树时才联网预检，且在安装 UI 依赖之前报告：原生源码取不到时不必先白等 UI 安装
            if (this.source && applicable.some(task => task.kind === "configure-native")) {
                const message = frameworkSourceProblem(await this.source.check(preparedState))
                this.signal.throwIfAborted()
                if (message) fatal.push({ key: "native-source", message })
            }
        }
        return { scope, state, snapshots: loaded.snapshots, proposedLocal, fatal, resolvable, idle, applicable }
    }

    private entry(state: ProjectState, task: SetupTask): TaskEntry {
        if (task.kind === "install-ui") return { spec: { id: "install-ui", title: "安装 UI 依赖", detail: `${state.project.ui.packageManager} install`, rootDir: state.rootDir }, run: output => this.node.install(state, output) }
        return { spec: { id: `configure-native-${task.flavor}`, title: `配置 native · ${task.flavor}`, detail: "cmake", rootDir: state.rootDir }, run: output => this.cmake.configure(state, task.flavor, output) }
    }

    async run(rootDir: string, scope: SetupScope, scanOnly = false): Promise<SetupResult> {
        try {
            while (true) {
                this.signal.throwIfAborted()
                const report = await this.tasks.status("检查本机工具与开发环境", () => this.scan(rootDir, scope))
                this.interaction.report(report, { listIdle: scanOnly })
                this.signal.throwIfAborted()
                if (report.fatal.length) return { status: "blocked", report }
                if (scanOnly) return { status: report.resolvable.length || report.applicable.length ? "blocked" : "completed", report }
                if (report.resolvable.length) {
                    const issue = report.resolvable[0]
                    if (issue.key === "local-tools" && report.proposedLocal) {
                        const accepted = await this.interaction.acceptTools(report.proposedLocal, report.state?.project.ui.packageManager)
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
                await this.beforeApply?.(report.state, scope)
                await assertSnapshots(report.snapshots)
                this.signal.throwIfAborted()
                // UI 依赖安装与各 flavor 的 configure 互不依赖，并行执行；任一失败时其余跑完再一起报告
                await this.tasks.all(report.applicable.map(task => this.entry(report.state!, task)))
                // 执行期间工程或本机配置被改动时，本次准备基于的是旧配置，不能宣告完成
                await assertSnapshots(report.snapshots)
                this.interaction.message("SETUP 完成", 'completed')
                return { status: "completed", report }
            }
        } catch (error) {
            if (error instanceof ResourcePlanChanged) throw error
            if (isAbortError(error)) throw error
            this.interaction.failure(`SETUP 失败：${errorMessage(error)}`)
            return { status: "failed" }
        }
    }
}
