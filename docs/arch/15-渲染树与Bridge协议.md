# 基本分工

在 `Arrange UI Pipeline` 中，Vue 负责 diff，Arrange Bridge 批量提交变更，C++ core 负责界面树、布局、绘制、命中测试。

# 性能原则

- 生产通信不以 JSON 为主。
- JS 到 C++ 只传变化，不传整棵树快照。
- 一次 Vue flush 后统一提交一个 batch。
- Canvas、动画、高频绘制不通过普通树 patch 传大对象。

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
  | { op: "setProp", id: NodeId, key: string, value: unknown }
  | { op: "setModifier", id: NodeId, modifier: ModifierDescriptor[] }
  | { op: "setText", id: NodeId, text: string }
```

操作应批量提交：

```ts
native.commit(ops)
```

# 生产协议

目标形态是简明命令缓冲：

```txt
BridgeCommandBuffer
  header
  opcodes
  numeric args
  string table
  value table
  callback handle table
```

JS 侧：

```txt
Vue renderer -> BridgeWriter -> native.commit(buffer)
```

C++ 侧：

```txt
BridgeReader -> 校验版本 -> 执行 op -> 标记 dirty
```

字段名、节点类型名、prop 名等应进入字符串表或符号表；回调不序列化函数本体，只传 callback handle。

# JSON 的位置

JSON 只用于旁路诊断：

- DevTools 展示。
- 诊断表层 badge / toast / error screen / log 的结构化快照。
- Bridge op trace。
- 错误屏诊断。
- 测试快照。
- 人类可读日志。

生产路径是：

```txt
CommandBuffer -> C++
```

调试路径是：

```txt
CommandBuffer -> DebugMirror -> JSON trace
```

# C++ 界面树

```cpp
struct ArrangeNode {
    NodeId id;
    NodeType type;
    Props props;
    ModifierChain modifier;
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

Bridge 传描述数组，但具体传递时走高效协议：

```json
[
  { "type": "padding", "value": { "all": 8 } },
  { "type": "background", "color": 4278190080 }
]
```

C++ 接收后编译成内部 Modifier elements。

相同 Modifier 描述应可用 hash / intern 复用，避免反复编译相同链条。

生产代码不得依赖 debug JSON 字符串搜索来解析 Modifier 语义。`modifierDebugJson` 只能用于日志、错误屏诊断、测试快照和人工排查。

以下信息必须严厉进入 typed bridge 字段或 C++ 内部结构：

- callback handle。
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

Bridge 执行 op 后标记影响范围：

- `StructureDirty`：节点增删、移动、子序变化。
- `LayoutDirty`：尺寸、文本、图片 intrinsic、约束类 Modifier 变化。
- `PaintDirty`：颜色、背景、边框、阴影、alpha 变化。
- `TransformDirty`：平移、缩放、旋转、graphicsLayer 变化。
- `HitTestDirty`：clickable、pointerInput、clip、focus、zIndex 等变化。
- `AccessibilityDirty`：角色、标题、描述、可用状态变化。
- `ResourceDirty`：图片、字体、外部资源变化。

目标是局部 layout、局部 repaint、局部命中缓存更新，不默认整树重算。

M1 收口阶段，重绘正确性优先于局部 repaint 优化。

必须 full repaint 的场景：

- 初次加载成功。
- reload / HMR reload。
- error -> loaded。
- loaded -> error。
- root tree 重建。
- editor resized。
- dev / dist source 切换。
- scroll / clip / transform 相关 dirty bounds 无法可靠证明正确时。

dirty repaint 只用于普通 prop/text/paint 小变化。dirty 清理必须发生在 repaint 调度语义明确之后，不能过早清掉导致漏画。

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
- 一个 Arrange render tree。
- 一个主 Surface。

不使用全局单例。

# Transform 与命中

`graphicsLayer`、平移、缩放、旋转等 transform 会影响默认命中测试；非平移变换的精确命中可后续再细化，但不能完全无视。
