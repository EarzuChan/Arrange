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

// 正本清源：Cluster是管理文本中的一块部分。目前的实现有些问题，之后要狠狠重构
export interface TextCluster {
    readonly id: string
    readonly canEditMissingCluster: boolean // HACK：这个就是王八蛋，什么叫做can edit missing！会有很大问题！！
    // 簇结构缺失，应创建！而不是掩耳盗铃
    // 我现在在想，创建是`在Generator里的每一个文件的创建逻辑中直接写Cluster结构`，还是`Cluster才是具备Cluster结构创建能力的，不管是Performer还是Generator都要调Cluster`。不管如何，遇到Region区域时，特异的结构创建逻辑都会委派给对应的Region

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
