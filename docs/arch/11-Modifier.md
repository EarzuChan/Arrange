# 模型

Modifier 是顺序敏感的洋葱模型。链条左侧先包裹右侧：

```ts
m.background(red).padding(dp(8))
m.padding(dp(8)).background(red)
```

两者效果不同。

# 生产事实源

Modifier 生产语义必须来自 QuickJS 直接读取的稳定 TS Modifier object shape 与 native core 的唯一编译结果：

```txt
JS ModifierDescriptor[]
-> QuickJS ModifierReader 直接读取 JSValue
-> native ModifierSpec / ModifierCompiler
-> CompiledModifier cached on LayoutNode
-> Layout / Paint / HitTest / Input / Invalidation 读取同一份编译结果
```

`modifierDebugJson` 只允许用于 diagnostics / devtools / 人工排查 / 测试快照，不得在参与布局、绘制、命中、滚动、输入、无障碍或 invalidation 中使用。

`__arrangeModifier.N.*` 展开字段、`__arrangeClickableEnabled`、`__arrangeVerticalScrollValue`、`__arrangeZIndex`、`__arrangeLayer*` 等 JS 层派生 prop 不得进入生产语义。clickable / scroll / weight / align / zIndex / graphicsLayer 等语义只能由 native core 的 `ModifierCompiler` 编译进 `CompiledModifier`。

`CompiledModifier` 必须保留当前支持 Modifier 的可执行顺序语义。Paint / Layout / HitTest 不能靠字符串补丁反推顺序，例如不能用 `style.type == "padding"` 之类的局部规则决定 background、border、clip 与 padding / size 的相对效果。至少 `padding().background()`、`background().padding()`、`size().background()`、`background().size()` 等顺序差异必须由结构化编译结果和测试保护。

绘制语义收敛为 typed paint op。`ModifierCompiler` 负责把 `background`、`border`、`alpha`、`dropShadow`、`innerShadow`、`clip`、`padding` 等字符串 payload 编译成明确的 paint chain op；Paint 阶段不可靠自由字符串 `style.type == ...` 作为分派依据。

`CompiledModifierDiff` 结构化地表达其变化来源。layout、paint、transform、parent data、zIndex、input、focus、scroll value、click event slot、scroll event slot 等变化应分别进入对应 dirty attribution。纯 event callback / event slot 替换不得触发无理由 measure / layout / paint。

新增 Modifier 同时补：

- TS typed descriptor / stable object shape。
- QuickJS ModifierReader。
- C++ 集中读取 / compile 到 `CompiledModifier`。
- dirty schema。
- no-debugJson / no-expanded-field 测试。

# 便捷组合

```ts
m.then(other: Modifier)
m.if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier)
```

`m.if` 是语法糖，作用等同条件分支拼接 Modifier。
# 阶段

Modifier 可作用于：

- 约束变换。
- 测量。
- 放置。
- 绘制前。
- 绘制后。
- 命中测试。
- 事件处理。

每个 Modifier 必须由 native core 的 `ModifierCompiler` 声明自己影响哪些阶段。

阶段声明必须能进入 dirty attribution：

| Modifier 类型 | dirty 影响 |
| --- | --- |
| size / padding / weight / text style | Layout + Paint |
| background / border / alpha / shadow | Paint |
| clickable / hoverable / focusable / pointerInput | HitTest / Input |
| zIndex | Paint + HitTest |
| offset / translation / scale / rotation | Transform + Paint + HitTest |
| verticalScroll / horizontalScroll | Layout 或 Place + Paint + HitTest |

无法证明局部边界时，必须由 FramePlan 选择显式 full fallback，并记录原因。

# 尺寸与约束

```ts
m.width(dp(100))
m.height(dp(40))
m.size(dp(100))
m.size(dp(100), dp(40))

m.requiredWidth(dp(100))
m.requiredHeight(dp(40))
m.requiredSize(dp(100))

m.widthIn({ min: dp(40), max: dp(200) })
m.heightIn({ min: dp(20), max: dp(80) })
m.sizeIn({ minWidth, maxWidth, minHeight, maxHeight })
m.defaultMinSize({ minWidth: dp(0), minHeight: dp(0) })

m.fillMaxWidth()
m.fillMaxWidth(0.5)
m.fillMaxHeight()
m.fillMaxHeight(0.5)
m.fillMaxSize()

m.wrapContentWidth()
m.wrapContentHeight()
m.wrapContentSize()
m.aspectRatio(1.618)

m.width(IntrinsicSize.Min)
m.height(IntrinsicSize.Max)
```

`fillMax*` 在有界约束下生效；无界约束下不得制造无限尺寸。

# 间距

```ts
m.padding(dp(8))
m.padding({ horizontal: dp(8), vertical: dp(4) })
m.padding({ start, top, end, bottom })
m.padding({ left, top, right, bottom })
```

`padding` 改变子节点约束，并把子节点尺寸加回自身尺寸。不提供 `margin`，因为不需要。

# 位置与父布局数据

```ts
m.offset({ x: dp(4), y: dp(0) })
m.absoluteOffset({ x: dp(4), y: dp(0) })

m.align(Alignment.Center)
m.weight(1)
m.weight(1, { fill: true })
m.matchParentSize()
m.zIndex(10)
```

- `offset` 不改变测量尺寸，只影响放置位置。
- `align`、`weight`、`matchParentSize` 是父布局数据。
- `zIndex` 同时影响绘制顺序和默认命中顺序。

# 背景、边框、裁剪

```ts
m.background(Color(0xFF2C2C2C))
m.background(Color(0xFF2C2C2C), rounded(dp(8)))

m.border(dp(1), Color(0xFF606060))
m.border(dp(1), Color(0xFF606060), rounded(dp(8)))

m.clip(rounded(dp(8)))
```

`background` 与 `border` 绘制在当前 Modifier 层的尺寸内。`clip` 裁剪后续绘制，不改变布局尺寸；命中测试默认仍按布局 bounds，精确形状命中后续另行设计。

普通容器默认不裁剪子内容。子节点、阴影、显式绘制、图层变换等可以在视觉上超出父容器 bounds；最终仍受祖先显式 clip、滚动 viewport clip 与宿主窗口根裁剪影响。

`clip` 是显式视觉裁剪，语义接近 Compose 的 `clip` / `clipToBounds` / `graphicsLayer(clip = true)`：只有用户声明裁剪、滚动容器建立 viewport 或根宿主裁剪时，才应裁掉视觉超出。不得把所有父容器都实现成默认 clip。

`clip` 必须保留 Modifier 顺序语义：

```ts
m.background(red).clip(rounded(dp(8))).background(blue)
m.clip(rounded(dp(8))).background(red)
```

以上链条的绘制顺序和裁剪作用范围不同，不能被折叠成同一种效果。

# 阴影

主推设计工具式阴影：

```ts
m.dropShadow({
  shape: rounded(dp(8)),
  radius: dp(12),
  spread: dp(2),
  offset: DpOffset(dp(0), dp(4)),
  color: Color(0x66000000),
})

m.innerShadow({
  shape: rounded(dp(8)),
  radius: dp(8),
  spread: dp(1),
  offset: DpOffset(dp(0), dp(2)),
  color: Color(0x33000000),
})
```

注意：我们不采用 `m.shadow(elevation)`，这和设计工具不接轨，太和 Material 捆绑，暂且淘汰。

# 绘制

```ts
m.drawBehind((scope) => {})
m.drawWithContent((scope, drawContent) => {})
m.drawWithCache((cache) => ({
  onDrawBehind(scope) {},
  onDrawWithContent(scope, drawContent) {},
}))
```

复杂路径、渐变、波形等应尽量使用缓存绘制。

# 图层与变换

```ts
m.alpha(0.5)
m.graphicsLayer({
  alpha: 0.8,
  scaleX: 1,
  scaleY: 1,
  rotationZ: 0,
  translationX: dp(0),
  translationY: dp(0),
  transformOrigin: TransformOrigin.Center,
  clip: false,
  shape: rounded(dp(8)),
})
```

图层变换不改变测量尺寸。精确变换后命中测试后续单独设计。

# 输入与交互

通用交互走 Modifier；样式不走 CSS 伪类，而是由响应式交互状态驱动。

```ts
const interaction = rememberInteractionState()

const modifier = computed(() =>
  m.background(interaction.hovered ? hoverBg : normalBg)
   .border(interaction.focused ? dp(2) : dp(1), interaction.focused ? focusColor : outline)
   .clickable({ interactionState: interaction, onClick })
)
```

```ts
m.clickable(() => {})
m.clickable({
  enabled: true,
  onClick,
  onDoubleClick,
  onLongClick,
  interactionState,
  role: Role.Button,
  focusable: true,
})

m.hoverable({ interactionState, onEnter, onExit })
m.focusable({ enabled: true, interactionState })
m.focusRequester(requester)
m.onFocusChanged((state) => {})
m.focusProperties({ canFocus, next, previous, up, down, left, right })
m.focusGroup()

m.pointerInput((scope) => {
  scope.onPointerDown(...)
  scope.onPointerMove(...)
  scope.onPointerUp(...)
  scope.onWheel(...)
})
```

语义：

- `clickable` 默认可获得焦点，支持鼠标左键、Enter、Space 激活。
- `clickable` 内部维护 hover / press / focus 状态；用户只有传入 `InteractionState` 才会把这些状态暴露给 JS。
- `hoverable` 只处理进入 / 离开；连续 hover move 用 `pointerInput`。
- `focusable` 加入焦点遍历；`focusRequester` 提供程序化请求焦点。
- `focusGroup` 影响方向焦点搜索，不改变布局、绘制或命中。
- 核心不提供 ripple、Material state layer 或默认 hover 色；组件库可在外部封装。

# 滚动

```ts
const state = rememberScrollState()

m.verticalScroll(state)
m.horizontalScroll(state)
m.scrollable(state, Orientation.Vertical)
```

`verticalScroll` / `horizontalScroll` 是布局型滚动：

- 自己成为 viewport。
- 按滚动轴给子节点无界主轴约束。
- 裁剪并平移子内容：scroll viewport 必须天然包含 viewport clip，不能只平移不裁剪。
- 更新 `ScrollState.value/maxValue/viewportSize/contentSize`。

scroll viewport clip 与普通 `m.clip(shape)` 同属于视觉裁剪，但来源不同：

- `m.clip(shape)` 由用户显式声明，形状来自 Modifier。
- `verticalScroll` / `horizontalScroll` 由滚动语义建立，默认裁剪到 viewport rect。
- Lazy 组件自身是滚动 viewport，也必须裁剪到 viewport rect。

滚动 viewport clip 不改变测量尺寸，不把内容从 layout tree 删除；它只限制绘制与命中范围。命中测试应优先按 viewport 裁掉不可见滚动内容，再进行子节点命中与事件派发。

`scrollable` 是手势型滚动：只接收滚动 delta，不自动移动内容；适合自定义控件、Canvas、旋钮轨道等。

普通滚动会创建完整子树，适合设置页、短表单、小面板。大型集合使用 Lazy 组件。

同方向普通滚动嵌套 Lazy 或另一个同向滚动容器时，开发期给出诊断。运行期规则：子容器优先消费；到边界后剩余 delta 交给父容器。

# 动画

```ts
m.animateContentSize()
```

值动画通过运行时 API 提供：

```ts
animateFloatAsState(...)
animateDpAsState(...)
animateColorAsState(...)
updateTransition(...)
```

基础动画属于核心设计；更复杂的动画编排后续细化。

动画语义在 JS runtime，帧时钟在 native host。`animate*AsState` 不得用 Promise / microtask 伪造逐帧刷新，必须通过 host `requestAnimationFrame` 进入 native frame pump。每个动画 tick 都应能产生 native typed mutation、native dirty 与 repaint。

`m.animateContentSize()` 也使用同一 FrameClock / repaint pump；它不另建计时系统。Canvas `frame` invalidation、未来 meter / waveform 等 UI-thread 高频显示也复用同一底座。

详见 `docs/adr/003-NativeFrameClock与动画刷新链路.md`。
