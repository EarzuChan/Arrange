# FrameSchedule 与 Native 内部正规化

本任务负责把 M2 的 native 输出链路收束到统一 FrameScheduler、FramePlan、SceneFramePipeline、hit-test、dirty attribution 与 PublishedFrame 语义。

本任务不允许新增第二调度中心，不允许 controller 绕过 FramePlan，不允许 paint 执行任何状态迁移。

# 目标

建立唯一输出链路：

```txt
VBlank tick / InputIntent / RuntimeStore / MutationTransaction / SlotUpdateBatch
-> InvalidationGraph
-> FramePlan
-> SceneFramePipeline
-> PublishedFrame
-> JUCE passive paint
```

# 任务

## 1. FrameScheduler 收束

FrameScheduler 只消费生产 VBlankSource 或测试 ManualVBlankSource 注入的 VBlank event。

要求：

- 生产视觉帧源唯一是 `JuceVBlankSource`。
- `VBlankReady` 是 visible UI runtime ready 的必要条件。
- 无 VBlankReady 时可入队 work，但不得推进 visual frame、JS Value Phase animation tick、SceneFramePipeline visual publish 或 repaint pump。
- reload、HMR、diagnostics、resource ready 只能请求 work 或 visual frame，不能自行输出。

禁止：

- animation timer fallback。
- visual frame timer fallback。
- maintenance timer pretending to be frame。
- synthetic production frame source。
- Promise / microtask / JS timer 伪造 frame。

## 2. Unified FramePlan

FramePlan 必须统一消费：

- InputIntent。
- RuntimeStore state change。
- MutationTransaction queue。
- SlotUpdateBatch。
- native invalidation。
- diagnostics invalidation。
- resource state。
- dirty attribution。

FramePlan 至少表达：

- drainComposition。
- runJsValuePhase。
- applyMutations。
- applySlotUpdates。
- measure。
- layout / place。
- buildPaint。
- buildHitTest。
- buildDiagnostics。
- publishFrame。
- passivePaint。
- fullRepaint。

每个阶段执行或跳过都必须能说明原因。

## 3. SceneFramePipeline 显式阶段化

SceneFramePipeline 必须显式执行：

```txt
applyTransactions
applySlotUpdates
resolveInvalidation
measureIfNeeded
layoutIfNeeded
buildPaintIfNeeded
buildHitTestIfNeeded
buildDiagnosticsIfNeeded
publishFrame
```

要求：

- tree apply、slot apply、measure、layout、DrawOps build、hit-test rebuild、diagnostics build 与 publish frame 收敛到这里。
- full layout / full repaint 只能作为显式 fallback，并记录 reason。
- 正确性优先于局部优化，但 full fallback 不能成为默认偷懒路径。

## 4. hit-test 正规化

hit-test 必须与 LayoutTree、ModifierCompiler、zIndex、clip、scroll viewport、transform 和 event interest 统一。

必须覆盖：

- 绘制顺序与命中顺序一致。
- zIndex 影响默认命中顺序。
- scroll viewport clip 裁掉不可见内容命中。
- explicit clip 与 scroll viewport clip 分开处理。
- graphicsLayer / offset / transform 影响命中。
- clickable / hoverable / focusable / pointerInput 事件兴趣来自 CompiledModifier。
- 无事件兴趣不跨 QuickJS 边界。
- event callback 必须来自真实 EventSlotRegistry。

禁止：

- 用未变换 bounds 做所有命中。
- 忽略 viewport clip。
- 根据字符串 prop 猜事件兴趣。
- 找不到 callback 时生成 fake valid slot。

## 5. dirty attribution 正规化

所有 mutation、slot update、native state change 都必须产出结构化 dirty attribution：

- StructureDirty。
- LayoutDirty。
- PaintDirty。
- TransformDirty。
- HitTestDirty。
- AccessibilityDirty。
- ResourceDirty。
- EventSlotDirty。

dirty attribution 至少能说明：

- source input / intent。
- changed field。
- affected node / scene。
- affected phase。
- reason。
- fallback reason。

要求：

- Draw slot 不触发布局。
- Layout slot 触发必要 layout dirty。
- Event slot 不触发无理由 layout / paint。
- native internal invalidation 不伪装成普通 prop。
- dirty 清理只能发生在 FramePlan 与 publish frame 语义明确之后。

## 6. PublishedFrame 与 paint purity

PublishedFrame 是 JUCE `paint()` 可读取的唯一绘制快照。

`paint()` 只允许：

```txt
read PublishedFrame
draw prepared DrawOps / display list
```

禁止：

- 探测 dev server。
- 读取文件。
- 执行 JS。
- 触发 Arrange Vue flush。
- apply mutation。
- apply slot update。
- measure。
- layout。
- build DrawOps。
- 设置 diagnostics error。
- 切换 loaded 状态。
- 清 dirty。
- request repaint。

# 完成标准

- 生产输出只有 VBlankSource 驱动。
- FramePlan 统一消费 MutationTransaction 与 SlotUpdateBatch。
- SceneFramePipeline 阶段显式可查。
- hit-test 与视觉位置、clip、zIndex、transform、event interest 一致。
- dirty role 行为可测。
- paint purity 有静态或行为测试保护。

# 禁止完成判定

出现以下情况，不得标记本任务完成：

- 还有生产 timer fallback 推进视觉帧。
- 某个 controller 直接 layout / repaint。
- paint 内执行状态迁移。
- hit-test 靠旧 bounds 或字符串 prop 猜测。
- full repaint 没有 reason。
- dirty 在 publish 前过早清理导致漏画风险。
