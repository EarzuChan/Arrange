# 动画 API 与 Transition

本任务负责完成 M2 的动画 authoring API、Transition 状态机与高层动画能力。

动画必须建立在 Arrange Vue、Reactive Slot Runtime、VBlankSource 与 Unified FramePlan 之上。动画不是 timer，不是 Promise loop，不是 component render tick。

# 目标

动画链路固定为：

```txt
VBlankTick
-> JS Value Phase
-> animated refs / transitions advance
-> SlotUpdateBatch
-> FramePlan
-> SceneFramePipeline
```

动画过程值变化不得默认触发 component render、VNode diff 或 generic prop patch。

# 任务

## 1. animatedXAsRef 基础 API

实现并接入：

- `animatedNumberAsRef`
- `animatedDpAsRef`
- `animatedColorAsRef`
- `animatedOffsetAsRef`
- `animatedSizeAsRef`
- `animatedRectAsRef`
- `animatedNumberArrayAsRef`

要求：

- 返回值保持 Ref authoring 心智。
- 绑定到 UI slot 后，tick 更新进入 JS Value Phase 与 SlotUpdateBatch。
- `Dp`、`Color`、`Offset`、`Size`、`Rect`、number array 都必须有 typed value lowering。
- number array 长度变化不得被当作普通动画 tick 糊弄，应作为 schema / structure 变化处理。

## 2. animation spec

实现基础 spec：

- `tween`
- `spring`
- `snap`
- `easing`

要求：

- duration、delay、easing、spring state 的时间推进只由 VBlank timestamp 驱动。
- spec 计算不直接 repaint。
- spec 计算结果必须进入 typed slot update。

## 3. Transition 状态机

`transition` 表达多值动画状态机。

必须支持：

- target state 变更。
- child animated value 注册。
- child animated value 退休。
- label / diagnostics name。
- 同一 VBlankTick 批量推进多个 child value。
- target 变化时取消、接续或重定向已有动画。
- unmount、branch remove、reload、HMR、QuickJS reset 时取消并退休 binding。

禁止：

- Transition 绕过 FramePlan。
- Transition 直接 apply layout / paint。
- 退出后继续持有旧 node id 或旧 JS function。

## 4. 高层动画

实现首批高层动画：

- `animateContentSize`
- `Crossfade`
- `AnimatedVisibility`

要求：

- `animateContentSize` 是 layout slot 动画，进入必要 layout dirty，不默认 full layout。
- `Crossfade` 的结构变化进入 Composition Phase，alpha 过程值进入 draw slot。
- `AnimatedVisibility` 的 visible target、enter / exit、event slot、hit-test 与 focus 行为必须明确。
- 退出动画期间不得留下可交互幽灵节点。

## 5. 动画诊断

动画诊断至少提供：

- component render count。
- VNode diff / patch count。
- JS Value Phase time。
- SlotUpdateBatch size。
- dirty role count。
- layout / paint triggered count。
- active animation count。
- retired animation binding count。

这些计数器必须来自真实主链路。

# 完成标准

- animated draw slot tick 不触发 component render / VNode diff。
- paint-only 动画不触发布局。
- layout 动画进入必要 layout dirty。
- Transition 多 child value 同一 VBlankTick 批量推进。
- `ManualVBlankSource.advanceFrame(timestamp)` 注入同一条生产调度路径。
- unmount / HMR / reload / error recovery 后动画 binding 退休。
- 高层动画不绕过 Reactive Slot Runtime。

# 禁止完成判定

出现以下情况，不得标记本任务完成：

- 动画由 JS timer、Promise、microtask 或 production timer fallback 推进。
- 动画 tick 默认触发普通 component render。
- 动画过程值塞进 generic prop patch。
- animateContentSize 默认 full layout。
- Crossfade / AnimatedVisibility 留下可命中幽灵节点。
- 动画测试只断言 JS ref 值，不断言 SlotUpdateBatch / DrawOps / FramePlan。
