本篇不可再他妈的变更，这是他妈的历史文件！与更新文档冲突的设定也不他妈的具有参考价值！

# ADR 004：单 UI Owner 线程与帧阶段调度

日期：2026-05-10

## 背景

M1 已经引入 native FrameClock 与 QuickJS RAF pump，解决动画用 Promise / microtask 伪造 frame 导致补间被一次 drain 完的问题。但继续复核真实链路后发现，当前表述仍容易把以下动作混成一团：

```txt
JS callback / RAF
-> drain microtasks
-> Bridge batch
-> LayoutTree apply
-> layout
-> repaint
```

这能跑通基础场景，但不够接近 Compose 的阶段模型。正规方向应是：状态变化先造成阶段失效；JS 世界完成类似 composition 的工作并提交界面变更意图；C++ 世界在统一 render phase 中消费这些变更并执行测量、布局和绘制准备。

同时需要明确线程归属。音频线程与 UI 主链路隔离；QuickJS、Vue、LayoutTree、布局与绘制状态不能被多个线程共同拥有。

## 决策

### 1. 使用单 UI Owner 线程模型

Arrange UI runtime 采用单 owner 模型。默认 owner 是 JUCE message thread。

以下对象和动作归 UI owner 线程：

```txt
QuickJS runtime / context
Vue App instance 与 reactive flush
Bridge commit 捕获
pending mutation queue
LayoutTree
LayoutEngine / TextLayoutService / PaintModel
输入状态、滚动状态、focus / hover / pressed 状态
JUCE Component 输入回调与 paint 回调
```

辅助线程可以存在，例如 HMR socket、文件读取、资源解码、日志写入等，但只能把不可变事件或结果 post 回 UI owner。辅助线程不得直接访问 QuickJS、Vue 状态、LayoutTree、LayoutEngine、PaintModel、JUCE Component 或诊断 UI 状态。

音频线程不得调用 JS，也不得直接访问 UI tree。音频高频数据必须通过原子、环形队列或快照转移到 UI owner 后再参与 UI 更新。

### 2. 一个主 FrameClock，两个阶段域

Arrange 不建立互相竞争的 JS 时钟与 C++ 时钟。正规模型是一个 native host 提供的主 FrameClock，在同一 UI owner 线程上推进两个阶段域：

```txt
JS Composition Phase
C++ Render Phase
```

JS Composition Phase 负责：

```txt
派发输入回调、RAF callback、外部 UI 事件
执行 QuickJS callback
drain 当前必须完成的 JS microtasks
让 Vue 完成 reactive flush / renderer patch
收集 native.commit(...) 提交的 Bridge mutations
```

C++ Render Phase 负责：

```txt
合并并消费 pending Bridge mutations
LayoutTree apply
dirty 分类与传播
measure / layout / place
构建或更新 DrawOps / display list / repaint intent
请求或执行 JUCE repaint
```

### 3. native.commit 只提交意图，不驱动布局

`native.commit(...)` 的目标语义是把 Bridge mutations 追加到 pending mutation queue。它不得在调用栈内直接 apply LayoutTree、执行 layout 或触发绘制。

同一 frame 或同一调度边界内产生的多次 commit 应合并，Render Phase 中统一消费。这样可以避免一次事件或一个动画 tick 内多次 apply / layout。

### 4. 输入事件立即派发，但视觉结果经 Render Phase

离散输入事件仍应立即进入语义处理或 JS 回调，例如 click、key、text input、focus / blur、gesture begin / end。这保证用户交互边界清晰。

但“立即派发”不等于“立即 apply/layout/draw”。JS 回调造成的 Vue 更新应先转为 pending mutations，再由 Render Phase 统一 apply、measure、layout 和绘制。

连续输入事件可以合并到 frame 或调度点，例如 pointer move、drag move、hover move、高频 wheel / trackpad delta。

### 5. RAF 是 Composition Phase 的输入，不是布局入口

`requestAnimationFrame` 由 native FrameClock 驱动。每帧 RAF callback 运行在 JS Composition Phase 内：

```txt
native frame tick
-> deliver RAF callbacks
-> JS animation state update
-> Vue flush / renderer patch
-> Bridge mutations 入队
```

RAF callback 后不得直接进入零散的 `LayoutTree apply -> layout -> repaint`。这些动作属于同一帧后续的 C++ Render Phase。

### 6. Render Phase 是三件套唯一入口

LayoutTree apply、measure、layout / place、DrawOps 构建和 repaint intent 应收敛到 Render Phase。reload、HMR reload、错误恢复、source 切换、resize、scroll、input、动画等来源只应标记 dirty、入队 mutation 或请求 frame。

无法证明局部 repaint 边界正确时，Render Phase 可以选择 full repaint；正确性优先于局部优化。

### 7. 历史设定的保留与修正

ADR 003 关于“native 提供 FrameClock / QuickJS RAF pump / Promise 不承担 frame 语义”的决策继续有效。

本 ADR 修正的是链路边界：ADR 003 中“RAF pump 后立即 apply / layout / repaint”的表述不再作为最终目标。最终目标以当前 `docs/arch/` 中的调度与运行时母文档为准。

## 影响

- `ArrangeEditor` 不应长期作为零散调度入口；它应逐步退化为 JUCE 宿主入口与 UI owner 事件来源。
- 需要形成明确的 Scheduler / UI Owner / Frame Phases / pending mutation queue 设计。
- 测试中的 `waitForIdle` 应等待 JS Composition Phase 与 C++ Render Phase 都稳定。
- 动画测试应覆盖：RAF callback 产生 mutation，Render Phase 消费 mutation 并产出中间 DrawOps 或 repaint intent。
- HMR、诊断 toast、错误屏恢复等应 request frame 或 full repaint，但不破坏用户 App tree 与 Render Phase 边界。

## 不做

- 不把 QuickJS 放到独立 OS 线程作为第一版目标。
- 不让辅助线程直接访问 UI 状态。
- 不把动画语义迁移到 C++。
- 不引入浏览器完整 event loop。
- 不要求每个平台第一版都接入真实 display link；JUCE timer 可作为 host FrameClock 的初始实现。
