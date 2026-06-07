import {existsSync} from "node:fs"
import {mkdir, readFile} from "node:fs/promises"
import {dirname, resolve} from "node:path"
import {createDefaultTextClusterRegistry} from "../managed/DefaultManagedDefinitions.ts"
import {ManagedTopologyResolver} from "../managed/ManagedTopology.ts"
import type {TextRegion, TextRegionCircumstances, TextRegionEditOptions} from "../managed/TextRegion.ts"
import type {ProjectContext} from "../project/ProjectState.ts"
import {hashText, writeTextFile} from "../utils/utils.ts"
import type {ConfigCheckReport} from "./ConfigReport.ts"

export class ConfigPerformer {
    constructor(private readonly topologyResolver = new ManagedTopologyResolver(), private readonly textClusters = createDefaultTextClusterRegistry()) { }

    // HACK：Performer 重新读文件，这是否合理？

    async perform(context: ProjectContext, report: ConfigCheckReport): Promise<void> {
        this.assertNoFatalProblems(report)
        this.assertNoInteractiveProblems(report)
        await this.performText(context, report)
        await this.performJson(context, report)
    }

    private async performText(context: ProjectContext, report: ConfigCheckReport): Promise<void> {
        const topology = this.topologyResolver.resolve("config", context)

        for (const fileTopology of topology.textFiles) {
            const fileReport = report.textFiles.find((file) => file.filePath === fileTopology.filePath)
            const absolutePath = resolve(context.rootDir, fileTopology.filePath)
            const exists = existsSync(absolutePath)
            let fileText = exists ? await readFile(absolutePath, "utf8") : "" // TODO：如果文件缺乏，要走重建流程，未来设想。不能搞空字符串假设

            if (fileReport?.fileHash !== null && fileReport?.fileHash !== undefined && hashText(fileText) !== fileReport.fileHash) throw new Error(`File changed since config check: ${fileTopology.filePath}`)

            for (const clusterTopology of fileTopology.clusters) {
                const clusterReport = fileReport?.clusters.find((cluster) => cluster.clusterId === clusterTopology.clusterId)
                if (clusterReport === undefined) throw new Error(`Missing config check report for cluster: ${clusterTopology.clusterId}`)

                const cluster = this.textClusters.get(clusterTopology.clusterId)
                const clusterLocation = cluster.locate(fileText)

                if (clusterLocation.kind !== "found" && !cluster.canEditMissingCluster) throw new Error(`Cannot edit ${clusterTopology.clusterId}: cluster structure is missing.`)
                // TODO：之后设想结构缺乏/文件缺乏的解决方案。现在这个canEditMissingCluster，可能是有办法重建结构？但要工程化可解释，而不是“从何而来”。所以我觉得难绷，CHECK！

                let editedClusterText = clusterLocation.kind === "found" ? clusterLocation.text : ""

                for (const resolvedRegion of clusterTopology.regions) {
                    const regionReport = clusterReport.regions.find((region) => region.regionId === resolvedRegion.region.id)
                    if (regionReport === undefined) throw new Error(`Missing config check report for region: ${resolvedRegion.region.id}`)

                    if (!shouldEdit(regionReport.result.kind)) continue

                    const location = resolvedRegion.region.seek(editedClusterText)
                    editedClusterText = this.applyTextRegionEdit(context, editedClusterText, resolvedRegion.region, location, {managed: true})
                }

                if (clusterLocation.kind === "found") fileText = replaceSpan(fileText, clusterLocation.span.start, clusterLocation.span.end, editedClusterText)
                else if (clusterLocation.kind === "missing" && editedClusterText.length > 0) fileText = appendBlock(fileText, editedClusterText)
            }

            await writeTextFile(absolutePath, fileText)
        }
    }

    private async performJson(context: ProjectContext, report: ConfigCheckReport): Promise<void> {
        const topology = this.topologyResolver.resolve("config", context)

        for (const fileTopology of topology.jsonFiles) {
            const fileReport = report.jsonFiles.find((file) => file.filePath === fileTopology.filePath)
            const absolutePath = resolve(context.rootDir, fileTopology.filePath)
            const exists = existsSync(absolutePath)
            const raw = exists ? await readFile(absolutePath, "utf8") : "{}" // TODO：同样的，得走重建流程，不能来个空Json假设。未来设想

            if (fileReport?.fileHash !== null && fileReport?.fileHash !== undefined && hashText(raw) !== fileReport.fileHash) throw new Error(`File changed since config check: ${fileTopology.filePath}`)

            const json = JSON.parse(raw) as unknown
            for (const resolvedRegion of fileTopology.regions) {
                const regionReport = fileReport?.regions.find((region) => region.regionId === resolvedRegion.region.id)
                if (regionReport === undefined) throw new Error(`Missing config check report for region: ${resolvedRegion.region.id}`)

                if (!shouldEdit(regionReport.result.kind)) continue
                resolvedRegion.region.edit(context.state, json)
            }

            await mkdir(dirname(absolutePath), {recursive: true})
            await writeTextFile(absolutePath, `${JSON.stringify(json, null, 2)}\n`)
        }
    }

    private assertNoFatalProblems(report: ConfigCheckReport): void {
        for (const file of report.jsonFiles) if (file.parseError) throw new Error(file.parseError)

        for (const region of report.textFiles.flatMap((file) => file.clusters.flatMap((cluster) => cluster.regions))) {
            if (region.result.kind === "invalid" || region.result.kind === "damaged") throw new Error(`Cannot perform config sync for ${region.regionId}: ${region.result.kind}`)
        }

        for (const region of report.jsonFiles.flatMap((file) => file.regions)) {
            if (region.result.kind === "invalid") throw new Error(`Cannot perform config sync for ${region.regionId}: ${region.result.kind}`)
        }
    }

    private assertNoInteractiveProblems(report: ConfigCheckReport): void {
        for (const region of report.textFiles.flatMap((file) => file.clusters.flatMap((cluster) => cluster.regions))) {
            if (region.result.kind === "invalid" || region.result.kind === "damaged") continue
            if (isAutomaticallyPerformable(region.result.kind)) continue
            throw new Error(`Config sync for ${region.regionId} requires interactive repair: ${region.result.kind}`)
        }

        for (const region of report.jsonFiles.flatMap((file) => file.regions)) {
            if (region.result.kind === "invalid") continue
            if (isAutomaticallyPerformable(region.result.kind)) continue
            throw new Error(`Config sync for ${region.regionId} requires interactive repair: ${region.result.kind}`)
        }
    }

    private applyTextRegionEdit(context: ProjectContext, clusterText: string, region: TextRegion, location: TextRegionCircumstances, options: TextRegionEditOptions): string {
        // CHECK：但Seek返回的Region Damaged怎么办，会不会炸肛了
        const replacement = region.renderText(context.state, options)

        if (location.kind === "missing") return `${clusterText.slice(0, location.insertAt)}${replacement}${clusterText.slice(location.insertAt)}`

        if (location.kind === "wrapped") return replaceSpan(clusterText, location.wrapperSpan.start, location.wrapperSpan.end, replacement)

        if (location.kind === "unwrapped") return replaceSpan(clusterText, location.contentSpan.start, location.contentSpan.end, replacement)

        throw new Error(location.message)
    }
}

function shouldEdit(kind: string): boolean {
    return kind === "outdated"
}

function isAutomaticallyPerformable(kind: string): boolean {
    return kind === "ok" || kind === "outdated"
}

function replaceSpan(text: string, start: number, end: number, replacement: string): string {
    return `${text.slice(0, start)}${replacement}${text.slice(end)}`
}

function appendBlock(text: string, block: string): string {
    const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`
    return `${prefix}${block}`
}
