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

组件状态、副作用、生命周期和依赖注入统一使用 `setup` / `<script setup>` 中的 Composition API。普通组件对象保留 props/emits、setup/render、name、inheritAttrs、局部 components/directives 注册及 slots 类型声明；`setup` 返回状态或 render，公开实例成员使用 setup context 的 `expose` / `defineExpose`。

Options API 的 data/computed/methods/watch、对象生命周期、mixins/extends、对象 provide/inject 和 expose 配置不属于组件契约；App 不提供 mixin 或 optionMergeStrategies。模板由 SFC 工具链编译，不提供组件 template/compilerOptions 或运行时编译器。公开配置签名见 [基础 API 形态](21-基础API形态.md)。

编译器和运行时共用组件配置名称集合：SFC 静态对象的非法键在编译期报告，动态对象在运行时报告，生产构建同样拒绝，不静默跳过。`defineOptions` 必须使用可静态检查、无展开项的对象，动态值可放在已声明字段中；普通组件对象的展开配置仍由最终运行时对象校验。错误保留 SFC 文件与可用的源码行列。

# Host vocabulary

Arrange host target 的基础词汇是：

```txt
Box / Row / Column / Spacer
Text / Input / Image / Icon
用户 Vue 组件，且最终展开为 Arrange host components

未来或还有：Canvas / FlowRow / FlowColumn / LazyColumn / LazyRow / LazyVerticalGrid / LazyHorizontalGrid
```

Arrange compiler 与 Framework 使用同一份正向 host schema。已知宿主的 prop 与事件名在编译期校验；动态输入和手写 render 在宿主边界校验。Modifier 描述和值由正式类型化 reader 校验，资源在候选帧发布前准备。用户组件自主声明 props，包括 style、class 等普通字段。

枚举输入使用有限联合类型；原生按照具体输入和轴向验证实际值。未知值、拼写错误或轴向不匹配须报告字段和值，拒绝无效更新，保持已发布帧不变；随后有效更新可继续使用原绑定。枚举不以默认值吞掉错误。

# `v-if`

`v-if` 表达结构增删。它进入 Composition Phase，并产生 create / insert / remove / delete 等结构 mutation。

要求：

- 删除分支必须退休对应 event slot 与 reactive slot binding。
- 重新出现分支必须重新建立 native node、Modifier、prop state 与 slot binding。
- 不保留不可见但仍参与 hit-test、focus、输入事件或绘制的幽灵节点。

# `v-for`

`v-for` 可用于小规模普通列表。可重排列表必须提供稳定 key。

未来的大型集合由 Lazy 组件承接；该能力未公开前，普通列表明确承担全部物化成本。Lazy 拥有可视范围物化、测量缓存、滚动状态、item key、content type 与回收策略；Lazy 不是 `v-for` 语法糖。

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
- 停用时退休原生节点、binding 与 callback，保留逻辑组件实例与状态；激活重新建立原生身份并同步最新值。
- 逻辑值依赖归组件 effect scope，最终逐出缓存或卸载时停止；停用期间不向已退休原生目标写入。

# Suspense

`Suspense` 的 default 与 fallback 内容都必须展开为 Arrange host component tree。

要求：

- fallback / resolved 切换进入结构 mutation。
- 异步错误进入 Arrange Vue error handling 与 Arrange diagnostics。
- pending / resolved 状态不得绕过 FramePlan。
- 延迟 fallback 与 defineAsyncComponent 的 loading delay、timeout 使用宿主帧时钟；完成、卸载与等待分支替换取消相应需求。
- 异步 setup 的迟到结果或拒绝不重新挂载已退休分支；编译后的顶层 await 不恢复已经退休的 setup 作用域。errorComponent 是显式错误展示边界；未处理错误进入宿主故障恢复路径。

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

# 对象创建与手写 render

setup 对每个组件实例执行一次。组合式对象在 setup 内创建，订阅与动画归创建时的 effect scope；独立 effectScope 由调用方 stop，手动 requestAnimationFrame 由创建者取消。ScrollState 为响应式数据对象，原生绑定随挂载/停用/卸载管理，不要求额外缓存工厂。

模板把普通表达式交给实际结构消费者或持久值消费者。手写 render 使用 `arrangeValue(() => expression)` 声明独立值输入；普通 TS 已经求出的值保持快照语义。组件 props/attrs 的值传递、computed、helper、scoped slots 均按实际读取建立依赖。

# Compiler 诊断

Arrange compiler 以 Arrange host target 为正向目标。未知宿主输入、事件或指令转换产生具体诊断及原始 SFC 位置。动态输入的值表达式携带文件、行列与输入名，求值和类型化提交错误保留该来源；组件附带 __file 供手写 render 错误归属。资源输入的路径或 URL 与编译来源一同传到原生绘制记录；资源准备错误保留资源路径和 SFC 行列，并经发布边界统一显示。上游维护和行为测试边界记录于各内部包 UPSTREAM.md。
