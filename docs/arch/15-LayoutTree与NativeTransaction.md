# 基本分工

在 `Arrange UI Pipeline` 中，Arrange Ts Runtime 负责 authoring、rearrange、phase-aware reactivity、host target lowering 与 typed UI slot scheduling；Arrange Framework Native Part 负责把 Arrange Ts Runtime 产生的 typed mutation、event slot update 与 slot update 直接接入 native boundary；C++ core 负责 scene state、LayoutTree、布局、绘制准备、命中测试与 dirty 归因。

Arrange 的 QuickJS 与 C++ 是直接就在一起的，不是传统“JS 前端向 C++ 后端传输协议”的关系。生产链路不建立 JSON、二进制 buffer、字符串 value 编码或 command buffer 协议。Arrange Framework Native Part 必须直接读取 `JSValue`、primitive、callback function 与稳定 runtime object shape，并构造 native typed `MutationTransaction` 与 `SlotUpdateBatch`。

# 性能原则

- JS 到 C++ 只提交变化，不传整棵树快照。
- Rearrange Phase 的离散界面变化进入 `MutationTransaction`。
- JS Value Phase 的 UI value 变化进入 `SlotUpdateBatch`。
- 批处理是 transaction / slot update 优化，不是序列化协议。
- Canvas、动画、高频绘制不通过结构重排 传大对象。
- QuickJS host 不做泛用 serializer；只按稳定 TS object shape / native API 参数读取字段。
- core 不解析 JSON、不解析 encoded string、不知道 QuickJS 业务对象。

# Arrange Ts 玩意儿 lowering

Arrange compiler / runtime 产生两类生产更新：

```txt
Rearrange mutations:
  create / delete / insert / remove node
  update measure policy
  set modifier
  update / retire event slot
  explicit native invalidation

Reactive slot updates:
  layout slot
  draw / paint slot
  transform slot
  hit-test slot
  event slot
  resource slot
  accessibility slot
```

节点应用只承接 Layout 所属 RearrangeNode 的布局结构、Policy、Modifier 与正式值绑定，见 [运行时](04-运行时.md)。原生输入依据 Policy、Modifier 和绑定的明确契约解码，不建立按 FA 名称分派的 host arrangable schema。运行时不得把任意 JS object 当作可生产提交的 UI payload。

# Native transaction API

QuickJS host 暴露给运行时的入口直接接收类型化操作与输入，不要求序列化：

```ts
native.beginRearrange()
native.createNode(id, 'LayoutNode')
native.insertChild(parent, id, index)
const policyBinding = native.registerBinding(id, 'measurePolicy')
native.updateBinding(policyBinding, policy)
const chainBinding = native.registerBinding(id, 'modifier')
native.updateBinding(chainBinding, modifier)
native.submitRearrange(complete)
```

`submitRearrange` 只提交候选并登记完成回执，不在调用栈内执行布局或发布。失败或取消经 `abortRearrange` 撤销边界内候选资源；回执关联独立提交身份，重载、取消和迟到完成不得误确认新事务。仅逻辑变化的空事务也必须保留回执。事务式逻辑生命规则见 [运行时](04-运行时.md)，Owner 执行时机见 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

TS 不 stringify、不编码二进制或 JSON command buffer；QuickJS 直接读取 JSValue，原生只消费正式类型化值。事件回调通过 Modifier 字段进入，不提供节点直属 callback prop。

# 值绑定 API

`registerBinding` 连接宿主正式输入或 Modifier 整链，`registerModifierBinding` 连接已发布的明确 Modifier handle；`updateBinding` 交付值，`releaseBinding` 退休绑定。绑定包含独立身份及代际，并关联 LayoutNode 身份/代际；Modifier 参数绑定还包含实例 handle，不能拿数组下标作为长期更新身份。

纯值更新可以不产生结构操作，但仍与结构及资源变更共享有序提交。所谓 SlotUpdateBatch 表示这批类型化值操作，不另建与 MutationTransaction 顺序隔离的第二套提交容器。getter 在 JS 值消费阶段执行，FFI 只接收通过校验的结果，不把任意 getter 传到绘制线程。

# QuickJS native boundary

QuickJS native boundary 的职责：

- 读取 node id、node type、child index、text 等 primitive。
- 按明确 Policy 与 Modifier 输入契约读取字段，不把文本元素转为宿主 text/value/textPresentation 属性。
- 按明确 Modifier object shape 读取 Modifier descriptor。
- 读取真实 JS callback function，并注册到 native event registry。
- 按明确 slot schema 读取 UI slot value。
- 构造 native typed `MutationTransaction`。
- 构造 native typed `SlotUpdateBatch`。
- 为 C++ -> JS callback 构造 JS primitive 或 JS object 参数。

QuickJS native boundary 禁止：

- 泛用 JS object -> JSON/string serializer。
- `EncodedAnyValue` 一类任意值编码。
- `modifierPayload` 字符串。
- command buffer / binary buffer 作为生产提交路径。
- 为兼容旧测试保留第二套 production semantics。

# MutationTransaction 与 SlotUpdate

结构、绑定、值及事件资源共享一个保留因果顺序的 operations 序列：

```cpp
using SubmissionOperation = std::variant<TreeMutation, RegisterBinding, RetireBinding, SlotUpdate, RegisterEventSlot, RetireEventSlot>;

struct MutationTransaction {
    std::vector<SubmissionOperation> operations;
    std::shared_ptr<RearrangeSubmission> rearrange;
};
```

不能先按类别拆分、再分别应用节点和事件，否则会打乱创建、绑定、更新、移除及退休的真实次序。`SlotUpdate` 通过 BindingHandle 指向既定受体，SlotValue 只容纳受支持的类型化输入；不存在任意字段路径写入或节点直属事件输入。事件资源只有被存续 Modifier 引用时才有调用资格。

SceneFramePipeline 在候选场景消费事务，再执行失效所需的测量、放置、绘制与命中准备，成功后发布并完成对应回执。失败保留已发布场景，向运行时报告候选失败，不自动重放已撤销候选。取消事务即使已被 Owner 取走，也不能应用或完成新上下文的回执。

类型化输入的失效必须准确：仅颜色变化不失效测量，尺寸变化进入必要布局，事件替换不无故失效绘制或布局，Painter 内容和固有尺寸分别影响实际消费者。节点删除、调用退休、停用、重载和错误恢复均须清理失效绑定。原生阶段的工作量优化另见对应布局及失效母文档。

# JSON 与诊断

JSON 只允许用于旁路诊断和人类可读输出：

- DevTools 展示。
- 诊断表层 badge / toast / error screen / log 的结构化快照。
- 错误屏诊断。
- 人类可读日志。

JSON 不允许作为 JS 到 C++ 的生产提交事实源，也不允许作为 Modifier、Prop、Event、Slot、Reload 或 Scroll 的生产编码。测试快照可以是 JSON 文件格式，但快照内容必须来自真实 native pipeline 的结果，不能反过来定义生产语义。

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

Prop 不是任意 JS value 的序列化结果。每类节点支持哪些 prop、每个 prop 的 native 类型、slot lowering、dirty role 与 unknown prop 的处理口径都必须明确。

要求：

- QuickJS host 按 prop schema 直接读取 JSValue。
- Arrange UI App compiler / runtime 按 prop schema 建立 typed prop op 或 reactive slot binding。
- core 接收 typed prop value。
- unknown prop 默认拒绝并诊断；若未来需要 extension / custom bucket，必须先为该 bucket 设计独立 schema、命名空间、dirty 影响与测试，不能把它变成任意对象后门。
- event prop 必须基于明确 schema，不得靠任意 `on*` 或包含 `EventSlot` 的字符串猜测。
- camelCase / kebab-case 若都公开支持，必须写入 API 契约并通过统一入口读取。

# Modifier 表达

JS 侧 Modifier 是不可变链：

```sfa
M.padding(8.dp).background(Color(0xFF000000))
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

typed mutation、slot update 或 native-first state change 后必须产出 dirty attribution。dirty 不只是 bit flag，还必须能记录或推导：

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

生产事实源在 `arrange_core` 与 Arrange Ts runtime 的明确边界内。Arrange Ts Side Runtime 负责 authoring、rearrange、phase-aware reactivity 与 typed slot scheduling；C++ Side Framework/Runtime 负责生产布局、绘制、命中与文本测量事实源。

# 生命周期

每个 `ArrangeEditor` 拥有：

- 一个 QuickJS runtime/context。
- 一个 Arrange UI App instance。
- 一个 `NativeScene` 或等价 scene state，其中包含 LayoutTree、event slots、dirty state 与渲染状态。
- 一个 scene host。

不使用全局单例。

# Transform 与命中

`graphicsLayer`、平移、缩放、旋转等 transform 会影响默认命中测试；非平移变换的精确命中可后续再细化，但不能完全无视。




