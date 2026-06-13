借用类似Kotlin的简练语法来阐释，实践中代码被写为TS

```kotlin
// ========== 公共 ==========
data class ProjectContext(val rootDir: String, val state: ProjectState)

// ========== 文件级景况 ==========
sealed interface TextFileCircumstances {
    data class Present(val text: String) : TextFileCircumstances
    object CarrierMissing : TextFileCircumstances
}

sealed interface JsonFileCircumstances {
    data class Present(val json: JsonValue) : JsonFileCircumstances
    object CarrierMissing : JsonFileCircumstances
    data class Unparsable(val message: String) : JsonFileCircumstances
}

// ========== File：新增实体抽象 ==========
// 自持「定位/解析既有文件」+「从零生成整文件(版式)」两种能力
sealed interface ManagedFile {
    fun path(ctx: ProjectContext): RuntimePath

    // 文本文件：直写 one-shot 区段 + 委托各簇 create 写簇区段；JSON文件：直接创建对象然后文本化
    fun create(ctx: ProjectContext): String // 要不要改到各自实现基类，然后返回FileCircumstances？
}

interface ManagedTextFile : ManagedFile {
    val clusters: List<TextCluster> // 本文件可能承载的全部簇（静态；SCAN时与激活集（文件拓扑）求交）

    fun seek(path: RuntimePath): TextFileCircumstances
}

interface ManagedJsonFile : ManagedFile {
    val regions: List<JsonRegion>

    fun seek(path: RuntimePath): JsonFileCircumstances
}

// 每种具体文件的实现类是无状态的静态类，但（Text/Json）的文件拓扑是有状态实例类

// ========== Cluster ==========

sealed interface TextClusterCircumstances {
    data class Found(val span: Span, val text: String) : TextClusterCircumstances
    object MissingOrDamaged : TextClusterCircumstances
}

interface TextCluster {
    val id: String
    val regions: List<TextRegion> // 本簇逻辑统辖的全部域
    fun seek(fileText: String): TextClusterCircumstances
    fun create(ctx: ProjectContext): String // 写模板 + 委派各 Region Render 其区域内容
}

// ========== TextRegion ==========

sealed interface TextRegionCircumstance {
    data class Wrapped(val wrapperSpan: Span, val contentSpan: Span, val content: String) : TextRegionCircumstance 
    data class WrapperDamaged(val message: String) : TextRegionCircumstance 
    data class Unwrapped(val contentSpan: Span, val content: String) : TextRegionCircumstance 
    data class Missing(val insertAt: Int?) : TextRegionCircumstance  // Int?，代表如果该点位无法自动确定，在Resolve期间得交互式处理
}

// 检查结果
sealed interface TextRegionCheckResult {
    data class ConfigInvalid(val message: String) : TextRegionCheckResult // 用户在“State”中的设定值非法
    
    object Missing(val insertAt: Int?) : TextRegionCheckResult
    object Idle : TextRegionCheckResult // 一切良好，在Resolve/Apply中对该区域都无需操刀
    data class Outdated(val expected: String, val wrapperSpan: Span) : TextRegionCheckResult // 在Resolve中无操刀，在Apply中自动更新
    
    data class Unwrapped(val contentSpan: Span, val content: String, val expected: String) : TextRegionCheckResult
    data class WrapperDamaged(val message: String) : TextRegionCheckResult
}

interface TextRegion {
    val id: String
    val clusterId: String
    
    fun seek(clusterText: String): TextRegionCircumstance
    fun check(state: ProjectState, circ: TextRegionCircumstance ): TextRegionCheckResult
    fun create(state: ProjectState): String // 内部会根据Managed开关的情况，决定是否让生成的文本被Wrapper包裹
}

// ========== JsonRegion，非文本，无需Seek ==========
sealed interface JsonRegionCheckResult {
    object Idle : JsonRegionCheckResult

    data class Outdated(val current: Any | Undefined, val expected: Any | Undefined) : JsonRegionCheckResult
    object Missing : JsonRegionCheckResult
    data class ConfigInvalid(val message: String) : JsonRegionCheckResult
}

interface JsonRegion {
    val id: String
    val path: List<String | Int> // 路径 Token

    fun check(state: ProjectState, json: JsonValue): JsonRegionCheckResult
    fun update(state: ProjectState, json: JsonValue)  // 更新那字段（增删改）
}
```