import {existsSync} from "node:fs"
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {createDefaultTextClusterRegistry} from "../managed/DefaultManagedDefinitions.ts"
import {ManagedTopologyResolver} from "../managed/ManagedTopology.ts"
import type {ProjectContext} from "../project/ProjectState.ts"
import {hashText} from "../utils/utils.ts"
import type {ConfigCheckReport, JsonFileCheckReport, TextFileCheckReport} from "./ConfigReport.ts"

export class ConfigChecker {
    constructor(private readonly topologyResolver = new ManagedTopologyResolver(), private readonly textClusters = createDefaultTextClusterRegistry(),) {
    }

    async check(context: ProjectContext): Promise<ConfigCheckReport> {
        const topology = this.topologyResolver.resolve("config", context)

        return {
            rootDir: context.rootDir,
            textFiles: await this.checkText(context, topology.textFiles),
            jsonFiles: await this.checkJson(context, topology.jsonFiles),
        }
    }

    private async checkText(context: ProjectContext, files: ReturnType<ManagedTopologyResolver["resolve"]>["textFiles"]): Promise<readonly TextFileCheckReport[]> {
        const reports: TextFileCheckReport[] = []

        for (const file of files) {
            const absolutePath = resolve(context.rootDir, file.filePath)
            const exists = existsSync(absolutePath)
            const fileText = exists ? await readFile(absolutePath, "utf8") : "" // TODO：同Performer，byd文件缺乏就必须不能这样。干你妈
            const fileHash = exists ? hashText(fileText) : null

            reports.push({
                filePath: file.filePath, exists, fileHash, clusters: file.clusters.map((clusterTopology) => {
                    const cluster = this.textClusters.get(clusterTopology.clusterId)
                    const clusterLocation = exists ? cluster.locate(fileText) : {kind: "missing" as const}

                    return {
                        clusterId: clusterTopology.clusterId,
                        location: clusterLocation,
                        regions: clusterTopology.regions.map((resolvedRegion) => {
                            const regionCircumstances = clusterLocation.kind === "found" ?
                                resolvedRegion.region.seek(clusterLocation.text) :
                                clusterLocation.kind === "damaged" ? {kind: "damaged" as const, span: clusterLocation.span, message: clusterLocation.message} : {kind: "missing" as const, insertAt: 0}

                            return {
                                itemId: resolvedRegion.item.id,
                                regionId: resolvedRegion.region.id,
                                filePath: file.filePath,
                                clusterId: clusterTopology.clusterId,
                                circumstances: regionCircumstances,
                                result: resolvedRegion.region.check(context.state, regionCircumstances),
                            }
                        }),
                    }
                }),
            })
        }

        return reports
    }

    private async checkJson(context: ProjectContext, files: ReturnType<ManagedTopologyResolver["resolve"]>["jsonFiles"]): Promise<readonly JsonFileCheckReport[]> {
        const reports: JsonFileCheckReport[] = []

        for (const file of files) {
            const absolutePath = resolve(context.rootDir, file.filePath)
            const exists = existsSync(absolutePath)

            if (!exists) {  // TODO：同Performer，byd文件缺乏就必须不能这样。干你妈
                reports.push({
                    filePath: file.filePath, exists: false, fileHash: null, regions: file.regions.map((resolvedRegion) => ({
                        itemId: resolvedRegion.item.id, regionId: resolvedRegion.region.id,
                        filePath: file.filePath, path: resolvedRegion.region.path,
                        result: {kind: "missing"}
                    }))
                })
                continue
            }

            const raw = await readFile(absolutePath, "utf8")
            const fileHash = hashText(raw)

            try {
                const json = JSON.parse(raw) as unknown

                reports.push({
                    filePath: file.filePath, exists: true, fileHash, regions: file.regions.map((resolvedRegion) => ({
                        itemId: resolvedRegion.item.id, regionId: resolvedRegion.region.id,
                        filePath: file.filePath, path: resolvedRegion.region.path,
                        result: resolvedRegion.region.check(context.state, json),
                    })),
                })
            } catch (error) {
                reports.push({
                    filePath: file.filePath, exists: true, parseError: error instanceof Error ? error.message : String(error), fileHash,
                    regions: file.regions.map((resolvedRegion) => ({
                        itemId: resolvedRegion.item.id,
                        regionId: resolvedRegion.region.id,
                        filePath: file.filePath,
                        path: resolvedRegion.region.path,
                        result: {kind: "invalid", message: `Invalid JSON in ${file.filePath}.`},
                    })),
                })
            }
        }

        return reports
    }
}
