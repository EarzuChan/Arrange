import type {JsonRegionResult} from "../managed/JsonRegion.ts"
import type {TextRegionCircumstances, TextRegionResult} from "../managed/TextRegion.ts"
import type {TextClusterLocation} from "../managed/TextCluster.ts"

export interface ConfigCheckReport {
    readonly rootDir: string
    readonly textFiles: readonly TextFileCheckReport[]
    readonly jsonFiles: readonly JsonFileCheckReport[]
}

export interface TextFileCheckReport {
    readonly filePath: string
    readonly exists: boolean
    readonly fileHash: string | null
    readonly clusters: readonly TextClusterCheckReport[]
}

export interface TextClusterCheckReport {
    readonly clusterId: string
    readonly location: TextClusterLocation
    readonly regions: readonly TextRegionCheckReport[]
}

export interface TextRegionCheckReport {
    readonly itemId: string
    readonly regionId: string
    readonly filePath: string
    readonly clusterId: string
    readonly circumstances: TextRegionCircumstances
    readonly result: TextRegionResult
}

export interface JsonFileCheckReport {
    readonly filePath: string
    readonly exists: boolean
    readonly parseError?: string
    readonly fileHash: string | null
    readonly regions: readonly JsonRegionCheckReport[]
}

export interface JsonRegionCheckReport {
    readonly itemId: string
    readonly regionId: string
    readonly filePath: string
    readonly path: readonly string[]
    readonly result: JsonRegionResult
}

export function hasConfigProblems(report: ConfigCheckReport): boolean {
    return [...report.textFiles.flatMap((file) => file.clusters.flatMap((cluster) => cluster.regions.map((region) => region.result.kind))),
        ...report.jsonFiles.flatMap((file) => file.regions.map((region) => region.result.kind))]
        .some((kind) => kind !== "ok")
}
