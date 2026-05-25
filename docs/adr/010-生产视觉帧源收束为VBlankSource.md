本篇不可再他妈的变更，这是他妈的历史文件！与更新文档冲突的设定也不他妈的具有参考价值！

# ADR 010：生产视觉帧源收束为 VBlankSource

日期：2026-05-17

## 背景

M1 使用 native host frame tick 解决 Promise / microtask 伪造 frame 的问题，但文档中仍保留了生产 timer fallback 的口径。后 M1 调度复盘发现，常态 timer fallback 会制造双时钟、重复 pump、帧间距锯齿和阶段重入风险。

Arrange 的 UI 是可见 native UI。生产视觉帧推进应绑定到宿主可见组件、peer 与显示帧源的生命周期。JUCE 的 `VBlankAttachment` 已经提供随组件 peer / display 关联的 frame callback；不同平台底层如何实现由 JUCE 和平台负责，对 Arrange 来说都抽象为 VBlankSource。

## 决策

Arrange 生产环境的视觉帧源唯一收束为：

```txt
JuceVBlankSource
```

即由 JUCE `VBlankAttachment` 或等价 platform display-frame source 驱动。VBlankReady 是 visible UI runtime ready 的必要阶段。没有 VBlankReady 时，runtime 可以加载 App、建立 pending transaction / slot update、接收输入或诊断事件，但不得推进 visual frame、JS Value Phase animation tick、SceneFramePipeline visual publish 或 repaint pump。

生产环境不提供：

```txt
animation timer fallback
visual frame timer fallback
maintenance timer pretending to be frame
synthetic production frame source
```

测试环境可以使用：

```txt
ManualVBlankSource
```

`ManualVBlankSource` 不是 timer。它不会自启动、不会后台 tick、不会模拟 wall-clock。它只在 native test harness 显式调用 `advanceFrame(timestamp)` 时，向同一条生产 FrameScheduler / FramePlan 路径注入一个 VBlank frame event。

## 影响

- 帧调度文档必须改为 VBlankSource-only 生产模型。
- M2 的 Arrange Vue / Reactive Slot Runtime 测试使用 ManualVBlankSource，而不是 TestTimer 或 JS timer。
- 动画、Canvas frame invalidation、meter / waveform 等 UI-thread 高频显示只随 VBlankSource 推进。
- reload、HMR、diagnostics、resource ready 等非视觉事件只能入队 work；视觉输出等待 VBlankReady 后的 VBlank tick。
- 删除生产 60Hz / 20Hz 自定义 frame timer 作为长期目标。

## 不做

- 不在生产路径引入备用 animation timer。
- 不用 JS `setTimeout`、Promise loop 或 microtask 模拟 frame。
- 不让测试 harness 用自动运行的 timer 驱动 frame。
- 不把 JUCE 内部某平台实现细节暴露为 Arrange 的第二套 clock 语义。



