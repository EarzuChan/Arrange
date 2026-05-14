# 基本分工

在 `Arrange UI Pipeline` 中，Vue 负责声明式 diff，QuickJS host 负责把 Vue renderer 的 host 操作接入 native transaction，C++ core 负责 scene state、LayoutTree、布局、绘制准备、命中测试与 dirty 归因。

Arrange 的 QuickJS 与 C++ 是同进程关系，不是传统“JS 前端向 C++ 后端传输协议”的关系。生产链路不建立 JSON bridge、二进制 bridge、字符串 value 编码或 command buffer 协议。QuickJS host 必须直接读取 `JSValue`、primitive 与 callback function，并构造 native typed `MutationTransaction`。

# 性能原则

- JS 到 C++ 只提交变化，不传整棵树快照。
- 一次 Vue flush 后可以统一提交一个 native transaction batch。
- 批处理是 transaction 优化，不是序列化协议。
- Canvas、动画、高频绘制不通过普通树 patch 传大对象。
- QuickJS host 不做泛用 serializer；只按稳定 TS object shape / native API 参数读取字段。
- core 不解析 JSON、不解析 encoded string、不知道 QuickJS 类型。

# Vue 自定义渲染器

Vue renderer 调用：

```txt
createElement
patchProp
insert
remove
setElementText
```

这些 host 操作必须进入 QuickJS native transaction API，而不是先生成可传输 BridgeOp。

目标形态：

```txt
Vue renderer host op
-> QuickJS native transaction API
-> QuickJS JSValue reader
-> native typed MutationTransaction
-> MutationTransaction queue
```

# Native transaction API

QuickJS host 暴露给 TS runtime 的生产入口应表达 native transaction，而不是 bridge protocol：

```ts
native.beginTransaction()
native.createNode(id, type)
native.deleteNode(id)
native.insertChild(parent, child, index)
native.removeChild(parent, child)
native.setText(id, text)
native.setProp(id, propNameOrId, value)
native.setModifier(id, modifierObject)
native.invalidate(intent)
native.endTransaction()
```

具体命名可随实现调整，但职责不能变：

- TS 不编码。
- TS 不 stringify。
- TS 不生成二进制 buffer。
- TS 不生成 JSON payload。
- QuickJS host 直接读 `JSValue`。
- QuickJS host 构造 core typed mutation。
- core 只消费 typed mutation。

`endTransaction()` 只表示 JS Composition Phase 提交界面变更意图。它不得在调用栈内直接执行 tree apply、measure、layout 或 repaint。提交后的 transaction 进入 `MutationTransaction` queue，由 [调度线程与帧阶段](26-调度线程与帧阶段.md) 定义的 SceneFramePipeline 按 FramePlan 统一消费。

# QuickJS native boundary

QuickJS native boundary 的职责：

- 读取 node id、node type、child index、text 等 primitive。
- 按明确 prop schema 读取 prop value。
- 按明确 Modifier object shape 读取 Modifier descriptor。
- 读取真实 JS callback function，并注册到 native event registry。
- 构造 native typed `MutationTransaction`。
- 为 C++ -> JS callback 构造 JS primitive 或 JS object 参数。

QuickJS native boundary 禁止：

- 泛用 JS object -> JSON/string serializer。
- `BridgeEncodedValue` 一类任意值编码。
- `modifierPayload` 字符串。
- command buffer / binary buffer 作为生产提交路径。
- 为兼容旧测试保留第二套 production semantics。

# MutationTransaction

`MutationTransaction` 是 JS Composition Phase 与 SceneFramePipeline 的 typed 边界：

```cpp
struct CreateNodeMutation;
struct DeleteNodeMutation;
struct InsertChildMutation;
struct RemoveChildMutation;
struct SetTextMutation;
struct SetPropMutation;
struct SetModifierMutation;
struct NativeInvalidationMutation;

using TreeMutation = std::variant<
    CreateNodeMutation,
    DeleteNodeMutation,
    InsertChildMutation,
    RemoveChildMutation,
    SetTextMutation,
    SetPropMutation,
    SetModifierMutation,
    NativeInvalidationMutation
>;

struct MutationTransaction {
    std::vector<TreeMutation> treeMutations;
    std::vector<EventSlotUpdate> eventSlotUpdates;
    std::vector<EventSlotId> retiredEventSlots;
};
```

C++ SceneFramePipeline 原子消费 transaction，更新 `NativeScene` 或等价 scene state 后再执行 dirty resolution、measure / layout / place / DrawOps preparation。event slot update 与 tree mutation 必须处于同一 apply 边界，避免 native tree 命中旧 callback。

# JSON 与诊断

JSON 只允许用于旁路诊断和人类可读输出：

- DevTools 展示。
- 诊断表层 badge / toast / error screen / log 的结构化快照。
- 错误屏诊断。
- 人类可读日志。

JSON 不允许作为 JS 到 C++ 的生产提交事实源，也不允许作为 Modifier、Prop、Event、Reload 或 Scroll 的生产编码。测试快照可以是 JSON 文件格式，但快照内容必须来自真实 native pipeline 的结果，不能反过来定义生产语义。

# C++ scene state 与 LayoutTree

长期概念上，C++ 侧生产状态分为：

- `NativeScene` / `NativeSceneState`：scene state owner，持有 LayoutTree、event slots、dirty state 与资源状态，不做 frame planning 或 JUCE paint。
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

# Prop 表达

Prop 不是任意 JS value 的序列化结果。每类节点支持哪些 prop、每个 prop 的 native 类型、unknown prop 的处理口径都必须明确。

要求：

- QuickJS host 按 prop schema 直接读取 JSValue。
- core 接收 typed prop value。
- unknown prop 默认拒绝并诊断；若未来需要 extension / custom bucket，必须先为该 bucket 设计独立 schema、命名空间、dirty 影响与测试，不能把它变成任意对象后门。
- event prop 必须基于明确 schema，不得靠任意 `on*` 或包含 `EventSlot` 的字符串猜测。
- camelCase / kebab-case 若都公开支持，必须写入 API 契约并通过统一入口读取。

# Modifier 表达

JS 侧 Modifier 是不可变链：

```ts
m.padding(dp(8)).background(Color(0xFF000000))
```

生产链路必须是：

```txt
TS stable Modifier object shape
-> QuickJS ModifierReader 直接读取 JSValue
-> native ModifierSpec / CompiledModifier
-> CompiledModifier cached on LayoutNode
-> Layout / Paint / HitTest / Input / Invalidation 读取同一份编译结果
```

`ModifierCompiler` 必须保留 Modifier 的可执行顺序语义。Layout、Paint、HitTest、Input 与 Invalidation 不能各自解析 Modifier payload。相同 Modifier 描述应可用 hash / intern 复用，避免反复编译相同链条。

生产代码不得依赖 debug JSON 字符串搜索、`__arrangeModifier.N.*` 展开字段或 `__arrangeClickableEnabled`、`__arrangeVerticalScrollValue`、`__arrangeZIndex`、`__arrangeLayer*` 等 JS 层派生 prop 来解析 Modifier 语义。`modifierDebugJson` 只能用于日志、错误屏诊断和人工排查，不得参与生产语义。

以下信息必须进入 typed native structure：

- event slot identity / event kind。
- scroll state handle / value / axis / enabled。
- text style。
- input editing props。
- resource ref。
- focus / hover / pointer interest。

# Event callback

事件 callback 是真实 JS function，不是字符串 token。

要求：

- QuickJS reader 从 prop / Modifier object 中直接读取 callback function。
- native event registry 保存 callback handle 与 typed event kind。
- 触发事件时直接 `JS_Call`。
- click 可无参数，或传 typed JS event object。
- input 传 JS string 或 typed JS event object。
- scroll 由 C++ 直接构造 JS object，例如：

```ts
{
    value: number,
    maxValue: number,
    viewportSize: number,
    contentSize: number,
    isScrollInProgress: boolean,
}
```

禁止把 scroll snapshot、input event、reload payload 等生产数据先转成 JSON string 再交给 JS 解析。

# Native invalidation

内部刷新或结构意图不得伪装成普通 prop。类似 `__arrangeNativeInputPaintInvalidation`、`__arrangeNativeInputStateInvalidation`、`__arrangeSubtreeReplaced` 这样的 magic prop 不能作为长期协议存在。

正确链路是：

```txt
native state changed
-> NativeInvalidationMutation / explicit dirty API
-> LayoutTree / InvalidationGraph
-> FramePlan
```

需要结构变化就用结构 mutation；需要失效就用明确 intent / dirty API。

# Dirty 分类

typed mutation 或 native-first state change 后必须产出 dirty attribution。dirty 不只是 bit flag，还必须能记录或推导：

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

生产事实源在 `arrange_core`。TS runtime 负责 Vue/SFC authoring、响应式状态与 native transaction 提交，不形成第二套生产布局、绘制、命中或文本测量事实源。

# 生命周期

每个 `ArrangeEditor` 拥有：

- 一个 QuickJS runtime/context。
- 一个 Vue App instance。
- 一个 `NativeScene` 或等价 scene state，其中包含 LayoutTree、event slots、dirty state 与渲染状态。
- 一个 scene host。

不使用全局单例。

# Transform 与命中

`graphicsLayer`、平移、缩放、旋转等 transform 会影响默认命中测试；非平移变换的精确命中可后续再细化，但不能完全无视。
