# 目标

Arrange Vue 是面向 Arrange host target 的 authoring、composition 与 scheduling 前端。本文定义 Arrange Vue 的宿主目标、authoring 能力与 lowering 口径。

Arrange Vue 仅服务于 Arrange 项目本身，不能作为独立通用 Vue runtime 使用，更不面向 Web / DOM 场景（道不同不相为谋！）；其语义必须服从 Arrange 的 Composition、Layout、Draw 与 FramePlan 链路。

Arrange Vue 的核心作用：

```txt
SFC / template / script setup
-> Arrange host component lowering
-> phase-aware dependency
-> typed mutation / typed slot update
-> FramePlan
```

# Authoring 能力

以下能力属于 Arrange Vue authoring 基础能力：

- SFC。
- `<script setup>`。
- props / emits。
- slots / scoped slots。
- `ref` / `reactive` / `computed`。
- `watch` / `watchEffect`。
- lifecycle hooks，例如 `onMounted`、`onUnmounted`。
- provide / inject。
- `v-if`。
- `v-for`。
- `v-model`。
- dynamic component。
- Pinia 类业务状态管理。
- memory routing 类导航组织。

这些能力必须 lowering 到 Arrange host components、Modifier、typed prop、event slot、resource slot、reactive slot、MutationTransaction 或 SlotUpdateBatch。

# Host vocabulary

Arrange host target 的基础词汇是：

```txt
Box / Row / Column / Spacer
Text / Input / Image / Icon / Canvas
FlowRow / FlowColumn
LazyColumn / LazyRow / LazyVerticalGrid / LazyHorizontalGrid
用户 Vue 组件，且最终展开为 Arrange host components
```

Arrange compiler 应识别 host components 并生成稳定 typed lowering。host component 的 prop、modifier、event、text、resource 与 reactive slot 都必须有明确 schema。

# `v-if`

`v-if` 表达结构增删。它进入 Composition Phase，并产生 create / insert / remove / delete 等结构 mutation。

要求：

- 删除分支必须退休对应 event slot 与 reactive slot binding。
- 重新出现分支必须重新建立 native node、Modifier、prop state 与 slot binding。
- 不保留不可见但仍参与 hit-test、focus、输入事件或绘制的幽灵节点。

# `v-for`

`v-for` 可用于小规模普通列表。可重排列表必须提供稳定 key。

大型集合使用 Lazy 组件。Lazy 拥有可视范围物化、测量缓存、滚动状态、item key、content type 与回收策略；Lazy 不是 `v-for` 语法糖。

# `v-model`

`v-model` 是受控 prop + event 的便捷写法。对 `Input` 等受控组件，应 lowering 到明确 schema：

```txt
modelValue
onUpdate:modelValue / onUpdate:model-value
```

事件 callback 必须来自真实 JS function，并注册为 typed event slot。

# Dynamic component

`<component :is="...">` 可用于 Arrange 内建组件与用户 Vue 组件。dynamic component 的最终产物必须是 Arrange host component tree。

# KeepAlive

`KeepAlive` 可以保留组件实例状态。其 native tree 激活、停用、event slot、resource slot 与 reactive slot binding 必须有明确行为：

- deactivated 子树不参与 hit-test、focus、输入事件或绘制。
- activated 子树重新同步必要 native state 与 slot binding。
- event slot 与 reactive slot 不泄漏到已停用子树。

# Suspense

`Suspense` 的 default 与 fallback 内容都必须展开为 Arrange host component tree。

要求：

- fallback / resolved 切换进入结构 mutation。
- 异步错误进入 Arrange Vue error handling 与 Arrange diagnostics。
- pending / resolved 状态不得绕过 FramePlan。

# Pinia 与业务状态

Pinia 类业务状态管理属于 semantic state。业务状态变化进入 Arrange Vue composition 或 phase-aware dependency，不直接访问 native scene、layout tree、FramePlan 或音频线程。

音频线程数据必须经互操作通道进入 UI owner，由 InputIntent / RuntimeStore / JS Value Phase / FramePlan 消费。

# Memory routing

导航组织采用 memory routing 语义：route state 驱动 Arrange component tree 切换。导航动作进入业务状态与 composition，不依赖外部宿主地址栏。

# 副作用

普通副作用使用 Arrange Vue Composition API：

- `onMounted` 启动订阅、frame callback 或资源请求。
- `onUnmounted` 取消订阅、释放资源并退休 slot binding。
- `watch` / `watchEffect` 处理业务状态变化。
- `watch(..., onCleanup)` 处理 keyed effect 清理。
- `effectScope` 管理组合式封装的作用域。

帧相关逻辑使用 Arrange VBlankSource 驱动的 frame API 或更高层动画 API。Promise / microtask、JS timer 或 production timer fallback 不表达 frame。

# 动画与 transition

动画 authoring 使用 Arrange runtime API，例如 `animatedXAsRef`、transition API 与高层 visibility / content size / crossfade API。动画过程值进入 JS Value Phase 与 Reactive Slot Runtime。动画过程值变化不默认触发 component render。语义见 [动画与Transition](28-动画与Transition.md)。

# Compiler 诊断

Arrange compiler 以 Arrange host target 为正向目标。无法 lowering 到 Arrange host target 的语法或节点必须产生清晰诊断：说明缺少 Arrange lowering，并指向对应 Arrange 组件、Modifier、theme、event slot 或 animation API。



