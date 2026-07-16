import type {ProjectState} from "../project/ProjectState.ts"
import type {TextSpan} from "./TextRegionWrapper.ts"

export type TextClusterLocation = {
    readonly kind: "found"
    readonly span: TextSpan
    readonly text: string
} | { readonly kind: "missing" } | {
    readonly kind: "damaged"
    readonly span: TextSpan
    readonly message: string
}

// 正本清源：Cluster是管理文本中的一块部分。目前的实现有些问题，之后要狠狠重构
export interface TextCluster {
    readonly id: string

    filePath(state: ProjectState): string

    locate(fileText: string): TextClusterLocation
}

export class TextClusterRegistry {
    private readonly clusters = new Map<string, TextCluster>()

    constructor(clusters: readonly TextCluster[] = []) {
        for (const cluster of clusters) this.register(cluster)
    }

    register(cluster: TextCluster): void {
        this.clusters.set(cluster.id, cluster)
    }

    get(id: string): TextCluster {
        const cluster = this.clusters.get(id)
        if (cluster === undefined) throw new Error(`Unknown text cluster: ${id}`)
        return cluster
    }
}
