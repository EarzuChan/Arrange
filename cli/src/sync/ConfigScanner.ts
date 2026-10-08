import { readFile, stat } from "node:fs/promises"
import type { ConfigRegistry } from "../config/ConfigRegistry.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import type { ConfigScope } from "../managed/ManagedFile.ts"
import type { CheckResult, FileCheckResult, Located } from "../managed/CheckResult.ts"
import type { JsonExpected, JsonPath } from "../managed/JsonRegion.ts"
import type { FileSnapshot } from "../util/FileUtils.ts"
import { errorMessage } from "../util/Utils.ts"
import type { ConfigScanReport, ConfigTarget } from "./ConfigScanReport.ts"

type FileReadResult = { readonly kind: "Loaded", readonly snapshot: FileSnapshot } | { readonly kind: "Fatal", readonly message: string }

export class ConfigScanner {
    constructor(private readonly registry: ConfigRegistry) { }

    get files() { return this.registry.files }
    get items() { return this.registry.items }

    async scan(state: ProjectState, scope: ConfigScope): Promise<ConfigScanReport> {
        const report: ConfigScanReport = { scope, fatal: [], resolvable: [], idle: [], applicable: [] }
        for (const id of state.project["managed-items"]) if (!this.items.some(item => item.id === id)) report.fatal.push({ path: "arrange.project.yaml", cause: "config-invalid", message: `未知 ManagedItem：${id}` })

        const paths = new Set<string>()
        for (const file of this.files) {
            if (scope !== "Global" && file.scope !== scope) continue

            const regions = file.kind === "text-file" ? file.clusters.flatMap(cluster => cluster.regions) : file.regions
            if (!regions.some(region => region.enabled(state))) continue

            const path = file.path(state)
            if (paths.has(path)) {
                report.fatal.push({ path, cause: "config-invalid", message: "多个 File 定义指向同一路径" })
                continue
            }

            paths.add(path)

            try {
                const read = await this.readFile(path)
                if (read.kind === "Fatal") {
                    report.fatal.push({ path, cause: "read-error", message: read.message })
                    continue
                }
                const target: ConfigTarget = { path, file, snapshot: read.snapshot }
                if (file.kind === "text-file") {
                    const result = file.check(state, read.snapshot.content)
                    if (!this.collectFileResult(report, target, result)) continue

                    for (const cluster of file.clusters) {
                        if (!cluster.regions.some(region => region.enabled(state))) continue
                        const child: ConfigTarget = { ...target, cluster }
                        const checked = cluster.check(state, result.value)
                        if (checked.kind === "Resolvable") {
                            report.resolvable.push({ target: child, cause: checked.cause, message: checked.message })
                            continue
                        }
                        report.idle.push({ target: child })
                        const inner = result.value.slice(checked.location.inner.start, checked.location.inner.end)
                        for (const region of cluster.regions) if (region.enabled(state)) this.collectText(report, { ...child, region }, region.check(state, inner), checked.location.inner.start)
                    }
                } else {
                    const result = file.check(state, read.snapshot.content)
                    if (!this.collectFileResult(report, target, result)) continue

                    for (const region of file.regions) if (region.enabled(state)) this.collectJson(report, { ...target, region }, region.check(state, result.value))
                }
            } catch (error) {
                report.fatal.push({ path, cause: "check-error", message: errorMessage(error) })
            }
        }

        return report
    }

    private async readFile(path: string): Promise<FileReadResult> {
        try {
            if (!(await stat(path)).isFile()) return { kind: "Fatal", message: "目标不是文件" }
            return { kind: "Loaded", snapshot: { path, content: await readFile(path, "utf8") } }
        } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "Loaded", snapshot: { path, content: null } } : { kind: "Fatal", message: errorMessage(error) }
        }
    }

    private collectFileResult<T>(report: ConfigScanReport, target: ConfigTarget, result: FileCheckResult<T>): result is Extract<FileCheckResult<T>, { kind: "Idle" }> {
        if (result.kind === "Fatal") {
            report.fatal.push({ path: target.path, cause: result.cause, message: result.message })
            return false
        }
        if (result.kind === "Resolvable") {
            report.resolvable.push({ target, cause: result.cause, message: result.message })
            return false
        }
        report.idle.push({ target })
        return true
    }

    private collectText(report: ConfigScanReport, target: ConfigTarget, result: CheckResult<string, Located>, offset: number): void {
        if (result.kind === "Applicable") report.applicable.push({ target, cause: result.cause, kind: "text", expected: result.expected, actual: result.actual, span: { start: offset + result.location.inner.start, end: offset + result.location.inner.end } })
        else this.collect(report, target, result)
    }

    private collectJson(report: ConfigScanReport, target: ConfigTarget, result: CheckResult<JsonExpected, JsonPath>): void {
        if (result.kind === "Applicable") report.applicable.push({ target, cause: result.cause, kind: "json", expected: result.expected, actual: result.actual, jsonPath: result.location })
        else this.collect(report, target, result)
    }

    private collect(report: ConfigScanReport, target: ConfigTarget, result: Exclude<CheckResult<unknown, unknown>, { kind: "Applicable" }>): void {
        if (result.kind === "Fatal") report.fatal.push({ path: target.path, cause: result.cause, message: result.message })
        else if (result.kind === "Resolvable") report.resolvable.push({ target, cause: result.cause, message: result.message })
        else report.idle.push({ target, expected: result.expected, actual: result.actual })
    }
}
