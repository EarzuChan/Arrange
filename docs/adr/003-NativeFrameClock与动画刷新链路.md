本篇不可再他妈的变更，这是他妈的历史文件！与更新文档冲突的设定也不他妈的具有参考价值！

# ADR 003：Native FrameClock 与动画刷新链路

日期：2026-05-09

## 背景

M1 真实链路发现 `animateColorAsState` 等动画只在目标变化时跳变，没有稳定补间。排查后确认这不是单个颜色插值函数的问题，而是 JS runtime 与 native host 之间缺少真实帧时钟：

```txt
JS 侧用 Promise / microtask 模拟 frame
-> QuickJS host 在一次 callback 后 drain 全部 pending jobs
-> 多个动画 tick 在同一轮被跑完
-> native 只 apply / repaint 一次
-> 视觉上表现为跳变
```

这会影响所有依赖帧推进的能力，包括：

- `animateFloatAsState`
- `animateDpAsState`
- `animateColorAsState`
- `updateTransition`
- `animateContentSize`
- 未来 Canvas `invalidation: "frame"`
- 未来 meter / waveform / spectrum 等 UI-thread 高频显示

因此需要把“时间与帧刷新”提升为 runtime / QuickJS / JUCE 之间的正式架构契约。

## 决策

### 1. JS 负责动画语义，native 负责帧时钟

动画状态机、easing、插值、取消、重启和 Vue 生命周期归属 JS runtime：

```txt
@arrange/runtime
  animate*AsState
  updateTransition
  animateContentSize
  tween / spring / snap / easing
```

native 不成为 Vue 值动画的语义事实源，不把 `animateColorAsState(...)` 之类的 reactive value 搬到 C++ 计算。

native 负责真实时间和帧推进：

```txt
arrange_juce / ArrangeEditor
  monotonic time
  frame cadence
  timer lifecycle
  repaint scheduling
```

### 2. QuickJS host 必须提供 host RAF

QuickJS 环境不是浏览器，不能依赖浏览器 event loop。`arrange_quickjs` 必须向 JS runtime 注入受 native 驱动的最小帧 API：

```txt
globalThis.requestAnimationFrame(callback)
globalThis.cancelAnimationFrame(handle)
globalThis.performance.now()
```

或内部等价的 Arrange FrameClock API，但公开给 runtime 的语义必须等同于 host RAF。

`requestAnimationFrame` 只能登记下一帧 callback，不能用 Promise / microtask 立即递归模拟。Promise 只能表示 microtask，不是 frame。

### 3. native frame pump

帧循环由 native host 驱动：

```txt
JS requestAnimationFrame(cb)
-> QuickJS host 记录 pending RAF callback
-> ArrangeEditor 启动/保持 frame timer
-> native tick(now)
-> QuickJS host pumpAnimationFrame(now)
-> 执行本帧 RAF callbacks
-> drain 本帧产生的 microtasks
-> 读取 incremental Bridge batch
-> C++ LayoutTree apply
-> layout / dirty / repaint
-> 若仍有 pending RAF，继续下一帧；否则停止或降频
```

每一帧都必须走完整生产链路：

```txt
reactive state
-> Vue patch
-> Bridge prop / modifier update
-> LayoutTree dirty
-> Layout / PaintModel DrawOps
-> JUCE repaint
```

### 4. 不能用一次 callback drain 完动画

QuickJS callback 返回时可以 drain 当前必须完成的 microtasks，但不得把后续 animation frame 当作同一轮 microtask 无限推进。

动画下一帧必须回到 native timer / frame pump。

### 5. C++ core 仍是渲染事实源

`arrange_core` 仍然只维护：

```txt
LayoutTree / LayoutEngine / PaintModel / HitTester / ScrollDispatcher / InputEditing / TextLayoutService / Invalidation
```

它不实现 Vue 动画语义；它只消费每帧 Bridge 更新后的事实树，并产出 layout / DrawOps。

### 6. reload / unmount / HMR 必须清理帧状态

以下场景必须取消 pending RAF callback，释放 JS callback handle，避免旧 App 继续驱动帧：

- reload
- HMR reload
- error recovery
- unmount
- source 切换
- QuickJS context reset

### 7. Canvas frame invalidation 复用同一 FrameClock

未来 Canvas `invalidation: "frame"`、动画驱动 Canvas、meter / waveform / spectrum UI-thread 显示，都应复用同一 native FrameClock / RAF pump，不另造并行计时系统。

音频线程仍不得调用 JS；音频高频数据进入 UI 线程后，才能由 frame pump 消费快照。

## 测试要求

M1 退出前必须补动画真实链路回归，不能只测 JS ref 值。

至少覆盖：

```txt
target reactive state change
-> host frame tick
-> animateColorAsState 产生中间色
-> Vue renderer commit incremental modifier prop
-> native LayoutTree apply
-> PaintModel DrawOps background color 为中间色
-> 后续 tick 到最终色
```

测试中应有可控 host frame clock。真实 Standalone / VST3 人工回归需确认视觉上平滑补间，不跳变。

## 不做

- M1 不引入完整浏览器 timer/event loop。
- M1 不把 Vue 值动画整体迁移到 C++。
- M1 不为每类动画单独实现一套 native 计时器。
- M1 不让 Promise / microtask 承担 frame 语义。

## 影响

这是 M1 动画收口的基础设施任务。完成后会成为后续动画、Canvas frame invalidation、Profiler frame time 与高频 UI 显示的共同底座。
