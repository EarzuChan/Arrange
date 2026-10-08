# 动画与 Transition

本文是 Arrange 动画与 transition 语义的母文档。公开 API 签名见 [基础API形态](21-基础API形态.md)，帧调度见 [调度线程与帧阶段](26-调度线程与帧阶段.md)，Reactive Slot Runtime 见 [运行时](04-运行时.md)。

# 目标

动画是 UI value 随 `VBlankSource` 推进的阶段化变化。动画过程值进入 JS Value Phase 与 Reactive Slot Runtime，形成 typed slot update，再由 FramePlan 与 SceneFramePipeline 消费。

动画过程值变化不得默认触发结构重排。结构变化仍属于 Rearrange Phase；动画只改变已经绑定到 layout、draw、transform、hit-test、event 或 resource slot 的 UI value。

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

Promise、microtask、JS timer、production timer fallback 或 synthetic production frame source 都不能表达动画帧。rAF、cancelRAF、公开 AnimationClock 和手动时钟均已删除；测试控制宿主帧源并使用生产调度器。每个 Owner 的动画通道在同一时间戳下批量采样，完成回调在整批值更新之后执行。

tween 与 snap 按 Owner 时间戳减去起始时间求进度；spring 按实际经过的秒数求解析振子结果，不按调用次数积累固定步长。跳帧直接采样最新时刻，不补跑或发布中间画面。重定向保留最近显示值及弹簧速度；目标与当前值相同且没有速度时立即释放帧需求。完成回调归属该次目标，整批采样之后已被停止或再次重定向的旧回调不再执行。

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

这些 API 返回 `Ref`。该 `Ref` 绑定到 UI slot 后，过程值更新进入 JS Value Phase 与 SlotUpdateBatch，不走结构重排链路。

值类型规则：

- `Number`：普通 JS number。
- `NumberArray`：按固定长度 number group 处理；长度变化属于结构或 schema 变化，不属于普通动画 tick。

- `Dp`：在 DP 声明域采样，Layout 随后按 Density 转 PX；改变 Density 不重启动画。
- `Color`：按裸 ARGB `number` 的四通道颜色处理。
- `Offset` / `Size` / `Rect`：固定字段的 DP 数值组；原生几何动画使用 PX。弹簧 visibilityThreshold 使用被采样通道的数值单位，stiffness、dampingRatio 与时间参数不当作长度。

颜色输入遵守 [基础类型](10-基础类型.md) 的 uint32 契约，四个字节通道分别插值，输出夹到 0..255 后四舍五入并打包。通道的内部工作向量复用，公开数组及几何对象仍是独立冻结快照，后续采样不能改动已交付值。

# Transition

`transition` 表达多值状态机。一个 target state 可以派生多个 animated child value；这些 child value 共享 target state、时间轴、生命周期与取消规则。

target state 变化进入 Transition 后，Transition 在 JS Value Phase 推进子动画，并为每个绑定到 UI slot 的 child value 生成 typed slot update。Transition 本身不绕过 FramePlan，也不直接 apply layout、paint 或 repaint。

Transition 需要支持：

- target state 变更。
- child animated value 注册与退休。
- label / diagnostics name。
- 同一 VBlankTick 内批量推进。
- arrangable unmount、branch remove、reload、HMR 与 QuickJS context reset 时取消并退休 binding。

`createInfiniteTransition` 为持续重复的 UI 值创建 Owner 作用域动画。数值、DP 和颜色 child 接收初始值、目标值及正时长 tween；`repeatMode` 支持 `restart` 与 `reverse`。所有 child 共用 Owner 的 VBlankSource 和动画时间轴，child 或 transition 停止、作用域销毁时释放帧需求。

无限 tween 的 delay 属于每个周期；延迟期间保持该周期的起点，reverse 的奇数周期起点为目标端。跨周期跳帧也按当前周期直接取值，不保留已经过时的前次采样。

# Animation Spec

内建 animation spec：

```ts
tween(...)
spring(...)
snap(...)
easing(...)
```

`tween` 表达固定 duration、delay 与 easing。`spring` 表达弹簧系统。`snap` 表达在下一授权采样中到达目标值。`easing` 提供常用曲线。

自定义曲线、keyframesWithSpline、复杂 path-based animation 与命令式 animation controller 不属于基础语义；进入里程碑前必须单独设计 API、生命周期、可测试性与 lowering 规则。

# 高层动画

基础高层动画：

```txt
animateContentSize
Crossfade
AnimatedVisibility
```

`animateContentSize` 属于 Modifier 能力，改变布局相关 slot，必须进入必要 layout dirty，不得默认 full layout。

`Crossfade` 显式接收 is（Arrangable 定义）、props（目标参数）及 targetState（切换身份），表达内容切换时的 alpha / draw transition。退出层保存自己的定义和参数，切换或反向动画不能拿新参数执行旧页面。Crossfade 不使用带参 Slot。结构进入 Rearrange Phase，过程 alpha 进入 JS Value Phase 与 draw slot update。

`AnimatedVisibility` 表达 visible target 与 enter / exit 过程。可见性结构边界、event slot、hit-test 与 focus 语义必须明确；退出动画期间不得留下可交互的幽灵节点。

# 生命周期

动画 binding 必须随宿主语义退休：

- arrangable unmount。
- `a-if` 分支剔除。
- dynamic arrangable 替换。
- Transition child value 剔除。
- HMR reload。
- manual reload。
- error recovery。
- source switch。
- QuickJS context reset。

KeepAlive 停用时保留最近采样值并冻结动画进度，不申请持续帧；恢复首个采样保持该值，之后按剩余进度继续。恢复时目标已经变化则从保留值重新定向。最终销毁取消目标订阅、完成回调及帧需求。

退休后的动画不得继续产出 SlotUpdateBatch，不得调用旧 callback，不得持有旧 node id 或旧 JS function。

# 诊断与测试

动画诊断至少能观察：

- arrangable render count。
- 重排作用域执行次数与节点结构操作次数。
- JS Value Phase time。
- SlotUpdateBatch size。
- dirty role count。
- layout / paint triggered count。

测试必须覆盖：

- animated draw slot tick 不触发结构重排。
- paint-only 动画不触发布局。
- layout 动画进入必要 layout dirty。
- Transition 多 child value 同一 VBlankTick 批量推进。
- unmount / reload / HMR 后 binding 退休。
- `ManualVBlankSource.advanceFrame(timestamp)` 注入同一条生产调度路径。
- 不规则帧、跨周期跳帧及欠阻尼、临界阻尼、过阻尼 spring 的相同时间戳结果一致。
- AnimatedVisibility 内 Input 的未绑定编辑值和受体身份在退出首帧及中途反向时保留，彻底退出后重入才重新初始化。

# 不做

- 不用 Promise、microtask 或 JS timer 模拟动画帧。
- 不引入 production animation timer fallback。
- 不让动画 tick 默认穿越结构重排。
- 不把动画过程值直接塞进 generic prop patch。
- 不在 paint 中推进动画。

