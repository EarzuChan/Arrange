# Phase-aware Reactivity 与 Reactive Slot Runtime

本任务负责建立 Arrange Vue 与 native FramePlan 之间的阶段化响应式模型。

核心原则：

```txt
Ref 的绑定位置决定失效阶段。
```

M2 必须让 UI value 变化从普通 component render / VNode diff / generic prop patch 中解放出来，进入明确的 slot binding、dirty role 与 SlotUpdateBatch。

# 目标

建立以下链路：

```txt
Ref / computed / animatedXAsRef
-> typed UI slot binding
-> JS Value Phase
-> SlotUpdateBatch
-> InvalidationGraph
-> FramePlan
-> SceneFramePipeline
```

# 任务

## 1. 定义 slot schema

必须建立明确 slot kind 与 field path 模型：

- LayoutSlot
- DrawSlot
- TransformSlot
- HitTestSlot
- EventSlot
- ResourceSlot
- AccessibilitySlot

每个 slot update 必须携带：

- scene / node id。
- slot kind。
- field path。
- typed value。
- dirty role。
- source / reason。
- binding id。

不允许：

- 以任意 JS object 作为 slot payload。
- 以字符串 path + any value 逃避 typed schema。
- 以 generic prop patch 伪装 slot update。

## 2. 建立 Reactive Slot Runtime

Reactive Slot Runtime 必须负责：

- 创建 slot binding。
- 追踪 slot dependency。
- 收集 dirty UI value。
- 生成 SlotUpdateBatch。
- 退休 binding。
- 维护 source / reason / phase counter。

必须覆盖：

- prop reactive binding。
- Modifier field reactive binding。
- event callback replacement。
- resource state binding。
- animation value binding。
- computed UI value binding。

## 3. 区分 Composition 与 UI slot dependency

Arrange Vue reactivity 必须区分：

- business / structure state：进入 Composition Phase。
- layout value：进入 layout slot dirty。
- draw value：进入 draw / paint slot dirty。
- transform value：进入 transform slot dirty。
- hit-test value：进入 hit-test slot dirty。
- event value：进入 event slot update。
- resource value：进入 resource dirty。

要求：

- 高频 draw / transform / animation tick 不默认触发 component render。
- layout slot 更新必须进入必要 layout dirty。
- draw slot 更新不得触发 measure / layout。
- event slot 替换不得触发无理由 layout / paint。

## 4. QuickJS typed slot update API

QuickJS host 必须提供 typed slot update 入口：

```txt
beginSlotBatch
updateSlot
retireSlotBinding
endSlotBatch
```

要求：

- QuickJS host 直接读取 JSValue。
- native 构造 typed `SlotUpdateBatch`。
- `endSlotBatch()` 只提交 batch，不能直接 apply tree、layout、draw 或 repaint。
- SlotUpdateBatch 由 FramePlan 消费。

## 5. Slot binding 生命周期

binding 必须在以下场景退休：

- component unmount。
- `v-if` 分支删除。
- dynamic component 替换。
- node remove / delete subtree。
- event callback replacement。
- HMR reload。
- manual reload。
- error recovery。
- source switch。
- QuickJS context reset。

退休后的 binding：

- 不得继续产出 slot update。
- 不得持有旧 node id。
- 不得调用旧 callback。
- 不得污染新 App。

## 6. 诊断与计数器

必须提供非 UI 诊断模型：

- component render count。
- VNode diff / patch count。
- JS Value Phase time。
- SlotUpdateBatch size。
- dirty role count。
- layout / paint triggered count。
- slot source / reason。
- binding create / retire count。

这些信息必须来自真实 runtime 与 FramePlan，不得由测试假造。

# 完成标准

- Reactive Slot Runtime 成为 UI value 更新主链路。
- SlotUpdateBatch 可由 native SceneFramePipeline 消费。
- paint-only slot 不触发布局。
- layout slot 触发必要 layout dirty。
- event slot 替换不触发无理由 measure / layout / paint。
- animated draw slot tick 不触发 component render / VNode diff。
- binding 生命周期在 reload、HMR、unmount、QuickJS reset 下完整。

# 禁止完成判定

出现以下情况，不得标记本任务完成：

- Ref 更新仍统一触发 component render / generic prop patch。
- slot update 只是普通 prop patch 的别名。
- dirty role 靠 native 端猜测字符串。
- SlotUpdateBatch 不经过 FramePlan 直接 repaint。
- binding 退休依赖全局清空但没有准确生命周期。
- 测试只断言 JS ref 值，不验证 native slot update 与 FramePlan。
