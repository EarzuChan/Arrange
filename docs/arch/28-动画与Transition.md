# 动画与 Transition

本文是 Arrange 动画与 transition 语义的母文档。公开 API 签名见 [基础API形态](21-基础API形态.md)，帧调度见 [调度线程与帧阶段](26-调度线程与帧阶段.md)，Reactive Slot Runtime 见 [运行时](04-运行时.md)。

# 目标

动画是 UI value 随 `VBlankSource` 推进的阶段化变化。动画过程值进入 JS Value Phase 与 Reactive Slot Runtime，形成 typed slot update，再由 FramePlan 与 SceneFramePipeline 消费。

动画过程值变化不得默认触发 component render、VNode diff 或 generic prop patch。结构变化仍属于 Composition Phase；动画只改变已经绑定到 layout、draw、transform、hit-test、event 或 resource slot 的 UI value。

# 帧语义

生产动画只由 `VBlankSource` 推进：

```txt
VBlankTick
-> JS Value Phase
-> animated refs / transitions advance
-> SlotUpdateBatch
-> FramePlan
-> SceneFramePipeline
```

Promise、microtask、JS timer、production timer fallback 或 synthetic production frame source 都不能表达动画帧。

# animatedXAsRef

基础 animated API：

```ts
animatedNumberAsRef(...)
animatedNumberArrayAsRef(...)

animatedDpAsRef(...)
animatedColorAsRef(...)
animatedOffsetAsRef(...)
animatedSizeAsRef(...)
animatedRectAsRef(...)
```

这些 API 返回 `Ref`，以保留 Arrange Vue authoring 心智。但该 `Ref` 被绑定到 UI slot 后，过程值更新进入 JS Value Phase 与 SlotUpdateBatch，不走普通 component render 链路。

值类型规则：

- `Number`：普通 JS number。
- `NumberArray`：按固定长度 number group 处理；长度变化属于结构或 schema 变化，不属于普通动画 tick。

- `Dp`：authoring 上是 Dp，runtime typed slot 中按布局数值处理。
- `Color`：按 Arrange color typed value 处理。
- `Offset` / `Size` / `Rect`：按固定字段的 typed number group 处理。

# Transition

`transition` 表达多值状态机。一个 target state 可以派生多个 animated child value；这些 child value 共享 target state、时间轴、生命周期与取消规则。

target state 变化进入 Transition 后，Transition 在 JS Value Phase 推进子动画，并为每个绑定到 UI slot 的 child value 生成 typed slot update。Transition 本身不绕过 FramePlan，也不直接 apply layout、paint 或 repaint。

Transition 需要支持：

- target state 变更。
- child animated value 注册与退休。
- label / diagnostics name。
- 同一 VBlankTick 内批量推进。
- component unmount、branch remove、reload、HMR 与 QuickJS context reset 时取消并退休 binding。

# Animation Spec

内建 animation spec：

```ts
tween(...)
spring(...)
snap(...)
easing(...)
```

`tween` 表达固定 duration、delay 与 easing。`spring` 表达弹簧系统。`snap` 表达立即到达目标值。`easing` 提供常用曲线。

自定义曲线、keyframesWithSpline、复杂 path-based animation 与命令式 animation controller 不属于基础语义；进入里程碑前必须单独设计 API、生命周期、可测试性与 lowering 规则。

# 高层动画

基础高层动画：

```txt
animateContentSize
Crossfade
AnimatedVisibility
```

`animateContentSize` 属于 Modifier 能力，改变布局相关 slot，必须进入必要 layout dirty，不得默认 full layout。

`Crossfade` 表达内容切换时的 alpha / draw transition。结构进入 Composition Phase，过程 alpha 进入 JS Value Phase 与 draw slot update。

`AnimatedVisibility` 表达 visible target 与 enter / exit 过程。可见性结构边界、event slot、hit-test 与 focus 语义必须明确；退出动画期间不得留下可交互的幽灵节点。

# 生命周期

动画 binding 必须随宿主语义退休：

- component unmount。
- `v-if` 分支删除。
- dynamic component 替换。
- Transition child value 删除。
- HMR reload。
- manual reload。
- error recovery。
- source switch。
- QuickJS context reset。

退休后的动画不得继续产出 SlotUpdateBatch，不得调用旧 callback，不得持有旧 node id 或旧 JS function。

# 诊断与测试

动画诊断至少能观察：

- component render count。
- VNode diff / patch count。
- JS Value Phase time。
- SlotUpdateBatch size。
- dirty role count。
- layout / paint triggered count。

测试必须覆盖：

- animated draw slot tick 不触发 component render / VNode diff。
- paint-only 动画不触发布局。
- layout 动画进入必要 layout dirty。
- Transition 多 child value 同一 VBlankTick 批量推进。
- unmount / reload / HMR 后 binding 退休。
- `ManualVBlankSource.advanceFrame(timestamp)` 注入同一条生产调度路径。

# 不做

- 不用 Promise、microtask 或 JS timer 模拟动画帧。
- 不引入 production animation timer fallback。
- 不让动画 tick 默认穿越普通 component render / VNode diff。
- 不把动画过程值直接塞进 generic prop patch。
- 不在 paint 中推进动画。

