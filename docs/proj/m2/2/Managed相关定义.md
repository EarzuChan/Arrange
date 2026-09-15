# M2.2 Managed 模型实现草案

长期定义见 [Arrange CLI 托管与同步模型](../../../arch/32-ArrangeCLI托管与同步模型.md)。本文只记录当前 TypeScript 重写需要落地的接口关系。

## 状态

```ts
interface ProjectState {
    readonly rootDir: string
    readonly project: ProjectDefinition
    readonly local: LocalDefinition | null
}
```

File、Cluster、Region、ManagedItem 都是无状态定义。它们不保存工程路径、文件内容、span 或上一次扫描结果；所有具体结果由传入的 `ProjectState` 和本次操作产生。

## 物理拓扑

```ts
interface ManagedFile {
    readonly id: string
    path(state: ProjectState): string
    scan(state: ProjectState): FileCircumstances
    create(state: ProjectState): string
}

interface ManagedTextFile extends ManagedFile {
    readonly clusters: readonly TextCluster[]
}

interface ManagedJsonFile extends ManagedFile {
    readonly regions: readonly JsonRegion[]
}

interface TextCluster {
    readonly id: string
    locate(text: string): ClusterCircumstances
    create(state: ProjectState): string
    readonly regions: readonly TextRegion[]
}

interface TextRegion {
    readonly id: string
    locate(clusterText: string): RegionCircumstances
    check(state: ProjectState, circumstances: RegionCircumstances): RegionCheckResult
    render(state: ProjectState, managed: boolean): string
}

interface JsonRegion {
    readonly id: string
    readonly path: readonly (string | number)[]
    check(state: ProjectState, json: JsonValue): RegionCheckResult
    update(state: ProjectState, json: JsonValue): void
}
```

File 负责文件级状态和整文件创建；Cluster 负责实际结构的外壳；Region 负责具体字段。Cluster 不能把整份文件当作自己的范围，也不能复制 Region 的期望值计算。

## 逻辑托管

```ts
interface ManagedItem {
    readonly id: string
    readonly regions: readonly RegionReference[]
}

interface RegionReference {
    readonly fileId: string
    readonly clusterId: string | null
    readonly regionId: string
}
```

ManagedItem 是逻辑／家族父级，可以跨文件、跨 Cluster 关联 Region。启用状态来自 `ProjectState.project.managed-items`。未启用的 Region 在 create 时生成普通内容，不写 wrapper，也不参加后续 sync。

## 扫描结果

扫描结果是本次运行的只读数据，不挂在静态定义上：

```ts
interface ScanReport {
    readonly files: readonly FileScanResult[]
    readonly blockingIssues: readonly ScanIssue[]
    readonly applicableUpdates: readonly ApplyUpdate[]
}
```

File 缺失、JSON 不可解析、Cluster 缺失／损坏、Region 缺失／未包裹／损坏、`extraneous` 和配置非法都必须有明确结果。父级问题存在时，子级结果标记为 skipped，而不是伪造结果。

## 生成与重扫

create、Resolve 中的缺失结构创建、Apply 的常规更新都委派同一套 File → Cluster → Region 定义。Resolve 的每次写入或配置修改都结束当前报告，重新加载 ProjectState，并从文件级重新 SCAN；不得手工补齐级联结果。
