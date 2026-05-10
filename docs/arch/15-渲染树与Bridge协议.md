# 基本分工

在 `Arrange UI Pipeline` 中，Vue 负责 diff，Arrange Bridge 批量提交变更，C++ core 负责 scene state、layout tree、布局、绘制准备、命中测试与 dirty 归因。

# 性能原则

- 生产通信不以 JSON 为主。
- JS 到 C++ 只传变化，不传整棵树快照。
- 一次 Vue flush 后统一提交一个 batch。
- Canvas、动画、高频绘制不通过普通树 patch 传大对象。
- Bridge 生产路径必须复用同一个 `BridgeWriter` 与 typed payload schema；QuickJS 同进程 object ops 是允许携带 callback binding 的生产提交形态，binary command buffer 是无 callback 的跨边界编码形态，二者不得各自维护一套 Modifier 编码。

# Vue 自定义渲染器

Vue renderer 调用：

```txt
createElement
patchProp
insert
remove
setElementText
```

这生成 Arrange Bridge 操作。

# Bridge 操作

```ts
type Op =
  | { op: "createNode", id: NodeId, nodeType: string }
  | { op: "deleteNode", id: NodeId }
  | { op: "insertChild", parent: NodeId, child: NodeId, index: number }
  | { op: "removeChild", parent: NodeId, child: NodeId }
  | { op: "setProp", id: NodeId, key: string, value: BridgeEncodedValue }
  | { op: "setModifier", id: NodeId, modifier: BridgeModifierPayload }
  | { op: "setText", id: NodeId, text: string }
```

`BridgeModifierPayload` 不是 `unknown`。它必须是标准 Modifier element payload：每个 element 有明确 `type` 与 typed value。QuickJS object commit 中允许 payload 附带 event slot callback binding；command buffer 中只能携带 serializable event slot token，不能携带 JS function。

操作应批量提交：

```ts
native.commit(ops)
```

`native.commit(...)` 只表示 JS Composition Phase 提交界面变更意图。它不得在调用栈内直接执行 tree apply、measure、layout 或 repaint。提交后的 mutations 进入 MutationTransaction queue，由 [调度线程与帧阶段](26-调度线程与帧阶段.md) 定义的 SceneFramePipeline 按 FramePlan 统一消费。

# 生产协议

Bridge 有两个边界形态，但只有一份 schema：

- `commit(ops)`：QuickJS 同进程生产路径。object ops 可携带 callback binding，用于注册 `EventSlotId -> JS function`。
- `commitCommandBuffer(bytes)`：跨边界 / fixture / 可序列化路径。command buffer 不能携带 JS function，只能携带 serializable value 与 event slot token。

命令缓冲目标形态是：

```txt
BridgeCommandBuffer
  header
  opcodes
  numeric args
  string table
  value table
  event slot table
```

JS 侧 object commit：

```txt
Vue renderer -> BridgeWriter -> typed Bridge object ops -> native.commit(ops) -> MutationTransaction queue
```

JS 侧 command buffer：

```txt
Vue renderer -> BridgeWriter -> typed Bridge payload -> native.commitCommandBuffer(bytes) -> MutationTransaction queue
```

C++ 侧：

```txt
SceneFramePipeline -> NativeScene / scene state apply -> BridgeReader -> 校验版本 -> 执行 op -> dirty attribution
```

字段名、节点类型名、prop 名等应进入字符串表或符号表；回调不序列化函数本体。生产事件字段传稳定 `EventSlotId`，QuickJS registry 负责 `EventSlotId -> 当前 JS function`。object commit 和 command buffer 必须对无 callback payload 保持等价语义。

# MutationTransaction

Bridge mutations 不直接驱动 tree apply。JS Composition Phase 产物进入 `MutationTransaction`：

```txt
MutationTransaction
  tree mutations / command buffer
  event slot updates
  retired event slots
  resource / dirty intent
```

C++ SceneFramePipeline 原子消费 transaction，更新 `NativeScene` 或等价 scene state 后再执行 dirty resolution、measure / layout / place / DrawOps preparation。event slot update 与 tree mutation 必须处于同一 apply 边界，避免 native tree 命中旧 callback。

# JSON 的位置

JSON 只用于旁路诊断：

- DevTools 展示。
- 诊断表层 badge / toast / error screen / log 的结构化快照。
- Bridge op trace。
- 错误屏诊断。
- 测试快照。
- 人类可读日志。

跨边界可序列化路径是：

```txt
CommandBuffer -> C++
```

同进程 QuickJS 生产路径是：

```txt
Typed object ops with callback binding -> QuickJS host -> MutationTransaction queue
```

调试路径是：

```txt
CommandBuffer -> DebugMirror -> JSON trace
```

禁止把 JSON trace 或 QuickJS 侧临时 object fallback 读取作为生产提交事实源。QuickJS host 的职责是接收 typed payload、绑定真实 event slot callback 并追加 transaction，不得另写一套 Modifier serializer 或生产 batch 解释器。

# C++ scene state 与 layout tree

长期概念上，C++ 侧生产状态分为：

- `NativeScene` / `NativeSceneState`：scene state owner，持有 layout tree、event slots、dirty state 与资源状态，不做 frame planning 或 JUCE paint。
- `LayoutTree`：统一生产树，服务 layout、paint、hit-test、input 与 accessibility，不拆成多套生产树。
- `LayoutNode`：统一主节点，派生 layout / paint / hit-test cache。

第三期起，历史 `RenderTree` 命名必须重命名并收口为 `LayoutTree`；`ArrangeNode` 必须重命名或收口为 `LayoutNode`。后续文档和新增代码不得继续引入新的 `RenderTree` 概念。

```cpp
struct LayoutNode {
    NodeId id;
    NodeType type;
    Props props;
    CompiledModifier modifier;
    std::vector<NodeId> children;
    LayoutState layout;
    PaintState paint;
};
```

# Modifier 表达

JS 侧 Modifier 是不可变链：

```ts
m.padding(dp(8)).background(Color(0xFF000000))
```

生产链路必须是：

```txt
JS ModifierDescriptor[]
-> Bridge setModifier typed payload
-> native core ModifierCompiler
-> CompiledModifier cached on LayoutNode
-> Layout / Paint / HitTest / Input / Invalidation 读取同一份编译结果
```

JSON 描述只允许作为诊断镜像或测试快照。C++ 接收 typed payload 后只能由 native core 的 `ModifierCompiler` 编译一次，并把 `CompiledModifier` 缓存在 `LayoutNode` 上。Layout、Paint、HitTest、Input 与 Invalidation 不能再各自解析 payload。相同 Modifier 描述应可用 hash / intern 复用，避免反复编译相同链条。

生产代码不得依赖 debug JSON 字符串搜索、`__arrangeModifier.N.*` 展开字段或 `__arrangeClickableEnabled`、`__arrangeVerticalScrollValue`、`__arrangeZIndex`、`__arrangeLayer*` 等 JS 层派生 prop 来解析 Modifier 语义。`modifierDebugJson` 只能用于日志、错误屏诊断、测试快照和人工排查。

以下信息必须进入 typed bridge 字段或 C++ 内部结构：

- event slot id / event slot kind。
- scroll state handle / value / axis / enabled。
- text style。
- input editing props。
- resource ref。
- focus / hover / pointer interest。

# Prop / Protocol 开发习惯

- 生产通信以 typed command buffer / typed props 为准；JSON 只能是诊断镜像。
- C++ 读取 encoded prop 必须走统一解码层，不能在各模块手写 `f:` / `s:` / `b:` / `h:` parser。
- camelCase / kebab-case 若都公开支持，必须写入 API 契约并通过统一入口读取。
- 新协议字段必须同步 native model、dirty 语义和测试；不得只在某个模块局部解析。

# Dirty 分类

Bridge 执行 op 或 native-first state change 后必须产出 dirty attribution。dirty 不只是 bit flag，还必须能记录或推导：

```txt
source input / intent
changed state / changed field
affected node / scene
affected phase
reason
fallback reason if full repaint
```

dirty 影响范围：

- `StructureDirty`：节点增删、移动、子序变化。
- `LayoutDirty`：尺寸、文本、图片 intrinsic、约束类 Modifier 变化。
- `PaintDirty`：颜色、背景、边框、阴影、alpha 变化。
- `TransformDirty`：平移、缩放、旋转、graphicsLayer 变化。
- `HitTestDirty`：clickable、pointerInput、clip、focus、zIndex 等变化。
- `AccessibilityDirty`：角色、标题、描述、可用状态变化。
- `ResourceDirty`：图片、字体、外部资源变化。
- `EventSlotDirty`：event slot 替换、退休、事件兴趣变化。

目标是局部 measure、局部 layout、局部 DrawOps rebuild、局部命中缓存更新，不默认整树重算。

正确性优先于局部 repaint 优化。无法证明局部边界时，必须由 FramePlan 选择显式 full fallback，并记录原因。

必须 full repaint 的场景：

- 初次加载成功。
- reload / HMR reload。
- error -> loaded。
- loaded -> error。
- root tree 重建。
- editor resized。
- dev / dist source 切换。
- scroll / clip / transform 相关 dirty bounds 无法可靠证明正确时。

dirty repaint 只用于普通 prop/text/paint 小变化。dirty 清理必须发生在 FramePlan 与 publish frame 语义明确之后，不能过早清掉导致漏画。

# LayoutTree 结构索引

统一生产树必须维护结构索引：

- `parentByNode`。
- 子序索引。
- zIndex / paint order / hit-test order 所需索引。

insert / remove / delete subtree 时必须同步维护 parent index 与 order index。dirty propagation 应沿 parent 链传播，不得通过遍历整树查 parent 作为长期实现。

# 布局在哪执行

布局、测量、命中测试与绘制都在 C++ / JUCE 侧执行。

理由：

- Text 测量依赖 JUCE 字体系统。
- Image intrinsic size 依赖资源。
- Canvas 与最终绘制在 JUCE。
- 性能与线程边界更清晰。

生产事实源在 `arrange_core`。TS runtime 负责 Vue/SFC authoring、响应式状态与 bridge 提交，不形成第二套生产布局、绘制、命中或文本测量事实源。

# 生命周期

每个 `ArrangeEditor` 拥有：

- 一个 QuickJS runtime/context。
- 一个 Vue App instance。
- 一个 `NativeScene` 或等价 scene state，其中包含 layout tree、event slots、dirty state 与渲染状态。
- 一个 scene host。

不使用全局单例。

# Transform 与命中

`graphicsLayer`、平移、缩放、旋转等 transform 会影响默认命中测试；非平移变换的精确命中可后续再细化，但不能完全无视。
