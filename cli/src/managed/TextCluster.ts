import type {ProjectContext} from "../project/ProjectState.ts"
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

export interface TextCluster {
    readonly id: string
    readonly canEditMissingCluster: boolean // HACK：这个很危险

    filePath(context: ProjectContext): string

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
