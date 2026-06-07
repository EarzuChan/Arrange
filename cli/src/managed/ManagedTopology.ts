import {createHash} from "node:crypto"
import type {ProjectContext} from "../project/ProjectState.ts"
import type {JsonManagedItem, ManagedItem, TextManagedItem} from "./ManagedItem.ts"
import type {JsonRegion} from "./JsonRegion.ts"
import type {TextRegion} from "./TextRegion.ts"
import {createDefaultManagedItemRegistry, createDefaultTextClusterRegistry} from "./DefaultManagedDefinitions.ts"
import {ManagedItemRegistry} from "./ManagedItemRegistry.ts"
import {TextClusterRegistry} from "./TextCluster.ts"

export interface ResolvedJsonRegion {
    readonly item: JsonManagedItem
    readonly region: JsonRegion
    readonly filePath: string
}

export interface ResolvedTextRegion {
    readonly item: TextManagedItem
    readonly region: TextRegion
    readonly filePath: string
    readonly clusterId: string
}

export interface JsonFileTopology {
    readonly filePath: string
    readonly regions: readonly ResolvedJsonRegion[]
}

export interface TextClusterTopology {
    readonly clusterId: string
    readonly regions: readonly ResolvedTextRegion[]
}

export interface TextFileTopology {
    readonly filePath: string
    readonly clusters: readonly TextClusterTopology[]
}

export interface ManagedTopology {
    readonly items: readonly ManagedItem[]
    readonly jsonFiles: readonly JsonFileTopology[]
    readonly textFiles: readonly TextFileTopology[]
}

export class ManagedTopologyCache {
    private readonly values = new Map<string, ManagedTopology>()

    get(type: string, context: ProjectContext, factory: () => ManagedTopology): ManagedTopology {
        const key = `${type}:${hashStableJson(context.state)}`
        const existing = this.values.get(key)
        if (existing !== undefined) return existing

        const created = factory()
        this.values.set(key, created)
        return created
    }
}

export class ManagedTopologyResolver {
    constructor(private readonly registry = createDefaultManagedItemRegistry(), private readonly textClusters = createDefaultTextClusterRegistry(), private readonly cache = new ManagedTopologyCache()) {
    }

    resolve(type: string, context: ProjectContext): ManagedTopology {
        return this.cache.get(type, context, () => this.createTopology(context))
    }

    private createTopology(context: ProjectContext): ManagedTopology {
        const enabledItems = this.registry.getAll().filter((item) => context.state.project["managed-items"].includes(item.id))
        const jsonRegions: ResolvedJsonRegion[] = []
        const textRegions: ResolvedTextRegion[] = []

        for (const item of enabledItems) {
            if (item.kind === "json") {
                const filePath = item.filePath(context)
                for (const region of item.resolveRegions(context)) jsonRegions.push({item, region, filePath})
                continue
            }

            for (const region of item.resolveRegions(context)) textRegions.push({
                item,
                region,
                clusterId: region.clusterId,
                filePath: this.textClusters.get(region.clusterId).filePath(context),
            })
        }

        return {
            items: enabledItems,
            jsonFiles: groupJsonRegions(jsonRegions),
            textFiles: groupTextRegions(textRegions),
        }
    }
}

function groupJsonRegions(regions: readonly ResolvedJsonRegion[]): readonly JsonFileTopology[] {
    const byFile = new Map<string, ResolvedJsonRegion[]>()
    for (const region of regions) pushMapArray(byFile, region.filePath, region)
    return [...byFile.entries()].map(([filePath, fileRegions]) => ({filePath, regions: fileRegions}))
}

function groupTextRegions(regions: readonly ResolvedTextRegion[]): readonly TextFileTopology[] {
    const byFile = new Map<string, ResolvedTextRegion[]>()
    for (const region of regions) pushMapArray(byFile, region.filePath, region)

    return [...byFile.entries()].map(([filePath, fileRegions]) => {
        const byCluster = new Map<string, ResolvedTextRegion[]>()
        for (const region of fileRegions) pushMapArray(byCluster, region.clusterId, region)

        return {
            filePath, clusters: [...byCluster.entries()].map(([clusterId, clusterRegions]) => ({clusterId, regions: clusterRegions})),
        }
    })
}

function pushMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key)
    if (existing === undefined) map.set(key, [value])
    else existing.push(value)
}

function hashStableJson(value: unknown): string {
    return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`

    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}
