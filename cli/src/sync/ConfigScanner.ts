import {cmakeListsFile} from "../cmake/CmakeStuffs.ts"
import {npmrcFile, packageJsonFile} from "../node-js/NodeJsStuffs.ts"
import type {ProjectState} from "../project/ProjectState.ts"
import type {ManagedFile, ConfigScope} from "../managed/ManagedFile.ts"
import type {ManagedItem} from "../managed/ManageItems.ts"
import type {CheckResult, Located} from "../managed/CheckResult.ts"
import type {JsonExpected, JsonPath} from "../managed/JsonRegion.ts"
import {managedItems} from "../managed/ManageItems.ts"
import {errorMessage} from "../util/Utils.ts"
import type {ConfigScanReport, ConfigTarget} from "./ConfigScanReport.ts"

export const managedFiles: readonly ManagedFile[] = [packageJsonFile, npmrcFile, cmakeListsFile]

export class ConfigScanner {
    readonly files: readonly ManagedFile[] = managedFiles
    readonly items: readonly ManagedItem[] = managedItems

    private validateDefinitions(): void {
        const owners = new Map<object, string>()
        for (const item of this.items) for (const region of item.regions) {
            if (owners.has(region) || region.managedItemId !== item.id) throw new Error(`Region 关联冲突：${region.id}`)

            owners.set(region, item.id)
        }

        const physical = new Set<object>()
        for (const file of this.files) for (const region of file.kind === "text-file" ? file.clusters.flatMap(cluster => cluster.regions) : file.regions) {
            if (physical.has(region) || !owners.has(region)) throw new Error(`Region 物理归属冲突或缺少 ManagedItem：${region.id}`)

            physical.add(region)
        }

        if (physical.size !== owners.size) throw new Error("有 Region 缺少物理归属")
    }

    async scan(state: ProjectState, scope: ConfigScope): Promise<ConfigScanReport> {
        this.validateDefinitions()
        const report: ConfigScanReport = {scope, fatal: [], resolvable: [], idle: [], applicable: []}
        for (const id of state.project["managed-items"]) if (!this.items.some(item => item.id === id)) report.fatal.push({path: "arrange.project.yaml", cause: "config-invalid", message: `未知 ManagedItem：${id}`})

        const paths = new Set<string>()
        for (const file of this.files) {
            if (scope !== "Global" && file.scope !== scope) continue

            const regions = file.kind === "text-file" ? file.clusters.flatMap(cluster => cluster.regions) : file.regions
            if (!regions.some(region => region.enabled(state))) continue

            const path = file.path(state)
            if (paths.has(path)) {
                report.fatal.push({path, cause: "config-invalid", message: "多个 File 定义指向同一路径"})
                continue
            }

            paths.add(path)

            try {
                if (file.kind === "text-file") {
                    const result = await file.check(state, path)

                    const target = this.collectFileResult(report, file, path, result)
                    if (!target) continue

                    if (result.kind !== "Idle") continue // 级联跳过

                    for (const entry of result.clusters) {
                        const child: ConfigTarget = {...target, cluster: entry.cluster}

                        if (entry.result.kind === "Resolvable") {
                            report.resolvable.push({target: child, cause: entry.result.cause, message: entry.result.message});
                            continue // 级联跳过
                        }

                        report.idle.push({target: child})

                        for (const region of entry.result.regions) this.collectText(report, {...child, region: region.region}, region.result, entry.result.location.inner.start)
                    }
                } else {
                    const result = await file.check(state, path)

                    const target = this.collectFileResult(report, file, path, result)
                    if (!target) continue

                    if (result.kind !== "Idle") continue // 级联跳过

                    for (const region of result.regions) this.collectJson(report, {...target, region: region.region}, region.result)
                }
            } catch (error) {
                report.fatal.push({path, cause: "check-error", message: errorMessage(error)})
            }
        }

        return report
    }

    private collectFileResult(report: ConfigScanReport, file: ManagedFile, path: string, result: any): ConfigTarget | undefined {
        if (result.kind === "Fatal") {
            report.fatal.push({path, cause: result.cause, message: result.message});
            return
        }

        const target: ConfigTarget = {path, file, snapshot: {path, content: result.kind === "Idle" ? result.text : null}}
        if (result.kind === "Resolvable") {
            report.resolvable.push({target, cause: result.cause, message: result.message});
            return
        }

        report.idle.push({target})
        return target
    }

    private collectText(report: ConfigScanReport, target: ConfigTarget, result: CheckResult<string, Located>, offset: number): void {
        if (result.kind === "Applicable") report.applicable.push({target, cause: result.cause, kind: "text", expected: result.expected, actual: result.actual, span: {start: offset + result.location.inner.start, end: offset + result.location.inner.end}})
        else this.collect(report, target, result)
    }

    private collectJson(report: ConfigScanReport, target: ConfigTarget, result: CheckResult<JsonExpected, JsonPath>): void {
        if (result.kind === "Applicable") report.applicable.push({target, cause: result.cause, kind: "json", expected: result.expected, actual: result.actual, jsonPath: result.location})
        else this.collect(report, target, result)
    }

    private collect(report: ConfigScanReport, target: ConfigTarget, result: Exclude<CheckResult<unknown, unknown>, { kind: "Applicable" }>): void {
        if (result.kind === "Fatal") report.fatal.push({path: target.path, cause: result.cause, message: result.message})
        else if (result.kind === "Resolvable") report.resolvable.push({target, cause: result.cause, message: result.message})
        else report.idle.push({target, expected: result.expected, actual: result.actual})
    }
}
