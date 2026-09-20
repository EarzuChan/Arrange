# 模型

Modifier 是顺序敏感的洋葱模型。链条左侧先包裹右侧：

```ts
M.background(red).padding(dp(8))
M.padding(dp(8)).background(red)
```

两者效果不同。

# 最终受体与实例归属

普通 Arrangable 接收、组合并显式转交 Modifier 描述；Layout Arrangable 是唯一最终接收者，其实现通过 RearrangeNode 管理的后端受体协调、物化实例链。对象与调用边界见 [运行时](04-运行时.md)。原生 LayoutNode 承挂实例链，不从 FA 名称推断行为。

同一不可变描述可交给多个 Layout。各受体分别拥有实例身份、缓存、动画及交互状态；描述复用不共享有状态实例。链条移除、受体退休、内容停用与恢复必须处理挂接、退订、回调代际和资源释放。

文本显示和编辑也是正式 Modifier 元素，使用同一顺序、协调、精确更新与退休机制。文本元素的测量和绘制几何在链条所在层确定，外部 padding、clip、transform 等正常包裹它；不能将文本元素展开成 Layout 的 textPresentation/text/value 特殊字段。文本与输入职责见 [文本输入与绘制](18-文本输入与绘制.md)。

# 生产事实源

Modifier 使用有序 descriptor，QuickJS 直接读取 JSValue 并生成类型化输入。原生协调器维护每层实例的身份、绑定、阶段数据与退休；measure、place、paint、hit-test 消费同一条实例链。相等输入不触发无关阶段，事件回调替换只失效输入相关数据。

显式 key 用于同类型元素的重排复用；无 key 元素按位置与类型协调。实例 handle 与数组下标分离，退休代际使旧绑定无法写入新实例。链条更新和单实例参数更新都进入同一原生提交。

回调引用也遵守同一元素匹配规则：只有存续的同一受体和同一函数才能复用回调资源，不能按节点 ID 和函数引用跨元素复用。keyed 移动保留有效资源；更换元素、移除后重建或退休子树使旧事件身份失效。FFI 可以保留类型化候选输入以连接回调和已发布 handle，但不创建原生实例、不预测 handle，候选缓存必须随失败撤销。

TS 方法使用明确的参数类型；原生 reader 校验字段集合、类型及取值，不忽略未知字段。新增能力必须同时实现 TS 参数、JSValue 解码、原生语义、失效、生命周期和真实链路测试。源码定位与 authoring 契约见 [Arrange Vue 宿主目标](27-ArrangeVue宿主目标.md)。

下面包含最终设计示例。正式导出与签名统一见 [基础 API 形态](21-基础API形态.md)；阴影、自定义绘制、InteractionState、程序化焦点、pointerInput 等尚属后续能力。

# 便捷组合

```ts
M.then(other: Modifier)
M.if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier)
```

`M.if` 是 Earzu Chan 大人发明的语法糖，作用等同条件分支拼接 Modifier。
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
M.width(dp(100))
M.height(dp(40))
M.size(dp(100))
M.size(dp(100), dp(40))

M.requiredWidth(dp(100))
M.requiredHeight(dp(40))
M.requiredSize(dp(100))

M.widthIn({ min: dp(40), max: dp(200) })
M.heightIn({ min: dp(20), max: dp(80) })
M.sizeIn({ minWidth, maxWidth, minHeight, maxHeight })
M.defaultMinSize({ minWidth: dp(0), minHeight: dp(0) })

M.fillMaxWidth()
M.fillMaxWidth(0.5)
M.fillMaxHeight()
M.fillMaxHeight(0.5)
M.fillMaxSize()

M.wrapContentWidth()
M.wrapContentHeight()
M.wrapContentSize()
M.aspectRatio(1.618)

M.width(IntrinsicSize.Min)
M.height(IntrinsicSize.Max)
```

`fillMax*` 在有界约束下生效；无界约束下不得制造无限尺寸。

# 间距

```ts
M.padding(dp(8))
M.padding({ horizontal: dp(8), vertical: dp(4) })
M.padding({ start, top, end, bottom })
M.padding({ left, top, right, bottom })
```

`padding` 改变子节点约束，并把子节点尺寸加回自身尺寸。不提供 `margin`，因为不需要。

# 位置与父布局数据

```ts
M.offset({ x: dp(4), y: dp(0) })
M.absoluteOffset({ x: dp(4), y: dp(0) })

M.align(Alignment.Center)
M.weight(1)
M.weight(1, { fill: true })
M.matchParentSize()
M.zIndex(10)
```

- `offset` 不改变测量尺寸，只影响放置位置。
- `align`、`weight`、`matchParentSize` 是父布局数据。
- `zIndex` 同时影响绘制顺序和默认命中顺序。

# 背景、边框、裁剪

```ts
M.background(Color(0xFF2C2C2C))
M.background(Color(0xFF2C2C2C), rounded(dp(8)))

M.border(dp(1), Color(0xFF606060))
M.border(dp(1), Color(0xFF606060), rounded(dp(8)))

M.clip(rounded(dp(8)))
```

`background` 与 `border` 绘制在对应 Modifier 层的尺寸内。`clip` 裁剪后续绘制，不改变布局尺寸；命中测试默认仍按布局 bounds，精确形状命中后续另行设计。

普通容器默认不裁剪子内容。子节点、阴影、显式绘制、图层变换等可以在视觉上超出父容器 bounds；最终仍受祖先显式 clip、滚动 viewport clip 与宿主窗口根裁剪影响。

`clip` 是显式视觉裁剪，语义接近 Compose 的 `clip` / `clipToBounds` / `graphicsLayer(clip = true)`：只有用户声明裁剪、滚动容器建立 viewport 或根宿主裁剪时，才应裁掉视觉超出。不得把所有父容器都实现成默认 clip。

`clip` 必须保留 Modifier 顺序语义：

```ts
M.background(red).clip(rounded(dp(8))).background(blue)
M.clip(rounded(dp(8))).background(red)
```

以上链条的绘制顺序和裁剪作用范围不同，不能被折叠成同一种效果。

# 阴影

主推设计工具式阴影：

```ts
M.dropShadow({
  shape: rounded(dp(8)),
  radius: dp(12),
  spread: dp(2),
  offset: DpOffset(dp(0), dp(4)),
  color: Color(0x66000000),
})

M.innerShadow({
  shape: rounded(dp(8)),
  radius: dp(8),
  spread: dp(1),
  offset: DpOffset(dp(0), dp(2)),
  color: Color(0x33000000),
})
```

注意：我们不采用 `M.shadow(elevation)`，这和设计工具不接轨，太和 Material 捆绑，不进入核心 API。

# 绘制

```ts
M.drawBehind((scope) => {})
M.drawWithContent((scope, drawContent) => {})
M.drawWithCache((cache) => ({
  onDrawBehind(scope) {},
  onDrawWithContent(scope, drawContent) {},
}))
```

复杂路径、渐变、波形等应尽量使用缓存绘制。

# 图层与变换

```ts
M.alpha(0.5)
M.graphicsLayer({
  alpha: 0.8,
  scaleX: 1,
  scaleY: 1,
  rotationZ: 0,
  translationX: dp(0),
  translationY: dp(0),
  transformOrigin: TransformOrigin.Center,
  clip: false,
})
```

图层变换不改变测量尺寸；绘制与命中消费同一层变换及裁剪，命中通过逆变换转换坐标。当前 graphicsLayer.clip 使用矩形裁剪，形状裁剪由独立 M.clip(shape) 表达。

# 输入与交互

通用交互走 Modifier；交互视觉由响应式交互状态驱动。

```ts
const interaction = createInteractionState()

const modifier = computed(() =>
  M.background(interaction.hovered ? hoverBg : normalBg)
   .border(interaction.focused ? dp(2) : dp(1), interaction.focused ? focusColor : outline)
   .clickable({ interactionState: interaction, onClick })
)
```

```ts
M.clickable(() => {})
M.clickable({
  enabled: true,
  onClick,
  onDoubleClick,
  onLongClick,
  interactionState,
  role: Role.Button,
  focusable: true,
})

M.hoverable({ interactionState, onEnter, onExit })
M.focusable({ enabled: true, interactionState })
M.focusRequester(requester)
M.onFocusChanged((state) => {})
M.focusProperties({ canFocus, next, previous, up, down, left, right })
M.focusGroup()

M.pointerInput((scope) => {
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
- 核心不提供 ripple、Material state layer 或默认 hover 色；Arrangable库可在外部封装。

# 滚动

```ts
const state = createScrollState()

M.verticalScroll(state)
M.horizontalScroll(state)
M.scrollable(state, Orientation.Vertical)
```

`verticalScroll` / `horizontalScroll` 是布局型滚动：

- 自己成为 viewport。
- 按滚动轴给子节点无界主轴约束。
- 裁剪并平移子内容：scroll viewport 必须天然包含 viewport clip，不能只平移不裁剪。
- 更新 `ScrollState.value/maxValue/viewportSize/contentSize`。

scroll viewport clip 与普通 `M.clip(shape)` 同属于视觉裁剪，但来源不同：

- `M.clip(shape)` 由用户显式声明，形状来自 Modifier。
- `verticalScroll` / `horizontalScroll` 由滚动语义建立，默认裁剪到 viewport rect。
- Lazy Arrangable自身是滚动 viewport，也必须裁剪到 viewport rect。

滚动 viewport clip 不改变测量尺寸，不把内容从 layout tree 删除；它只限制绘制与命中范围。命中测试应优先按 viewport 裁掉不可见滚动内容，再进行子节点命中与事件派发。

`scrollable` 是手势型滚动：只接收滚动 delta，不自动移动内容；适合自定义控件、Canvas、旋钮轨道等。

普通滚动会创建完整子树，适合设置页、短表单、小面板。大型集合使用 Lazy Arrangable。

同方向普通滚动嵌套 Lazy 或另一个同向滚动容器时，开发期给出诊断。运行期规则：子容器优先消费；到边界后剩余 delta 交给父容器。

# 动画

```ts
M.animateContentSize()
```

值动画通过 Arrange runtime API 提供：

```ts
animatedNumberAsRef(...)
animatedDpAsRef(...)
animatedColorAsRef(...)
transition(...)
```

动画语义由 JS Value Phase 推进，生产视觉帧源由 VBlankSource 提供。动画过程值变化进入 Reactive Slot Runtime，并产生 typed slot dirty；它不得默认触发结构重排。

`M.animateContentSize()` 复用同一 VBlankSource、JS Value Phase、SlotUpdateBatch 与 FramePlan。Canvas `frame` invalidation、meter / waveform 等 UI-thread 高频显示也复用同一底座。

详见 [动画与Transition](28-动画与Transition.md)、[运行时](04-运行时.md) 与 [调度线程与帧阶段](26-调度线程与帧阶段.md)。
