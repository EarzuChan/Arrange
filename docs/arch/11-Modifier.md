# 模型

Modifier 是顺序敏感的洋葱模型。链条左侧先包裹右侧：

```ts
M.background(red).padding(8, 0)
M.padding(8, 0).background(red)
```

两者效果不同。

本文 `ts` 代码块采用纯 `.ts` 的真实数值参数，长度使用平铺的 `(dp, px)` 双通道，颜色使用 ARGB 数字。单位含义见 [基础类型](10-基础类型.md)，SFA 模板与脚本的对应写法见 [SFA 与模板写法](33-SFA与模板写法.md#sfa-与纯-typescript-的编译边界)；后续能力的示例为设计草案。

# 最终受体与实例归属

普通 Arrangable 接收、组合并显式转交 Modifier 描述；Layout Arrangable 是唯一最终接收者，其实现通过 RearrangeNode 管理的后端受体协调、物化实例链。对象与调用边界见 [运行时](04-运行时.md)。原生 LayoutNode 承挂实例链，不从 FA 名称推断行为。

同一不可变描述可交给多个 Layout。各受体分别拥有实例身份、缓存、动画及交互状态；描述复用不共享有状态实例。链条移除、受体退休、内容停用与恢复必须处理挂接、退订、回调代际和资源释放。

文本显示和编辑也是正式 Modifier 元素，使用同一顺序、协调、精确更新与退休机制。文本元素的测量和绘制几何在链条所在层确定，外部 padding、clip、transform 等正常包裹它；不能将文本元素展开成 Layout 的 textPresentation/text/value 特殊字段。文本与输入职责见 [文本输入与绘制](18-文本输入与绘制.md)。

声明单位在 Layout 的受追踪读取中解析为原生 PX 输入，共享声明不修改；解析缓存与 Modifier 实例协调分别承担数值复用和原生身份职责。具体单位、响应式 Density 与 SFA 消融见 [基础类型](10-基础类型.md)。

# 生产事实源

Modifier 使用有序 descriptor，QuickJS 直接读取 JSValue 并生成类型化输入。原生协调器维护每层实例的身份、绑定、阶段数据与退休；measure、place、paint、hit-test 消费同一条实例链。相等输入不触发无关阶段，事件回调替换只失效输入相关数据。

显式 key 用于同类型元素的重排复用；无 key 元素按位置与类型协调。实例 handle 与数组下标分离，退休代际使旧绑定无法写入新实例。链条更新和单实例参数更新都进入同一原生提交。

回调引用也遵守同一元素匹配规则：只有存续的同一受体和同一函数才能复用回调资源，不能按节点 ID 和函数引用跨元素复用。keyed 移动保留有效资源；更换元素、移除后重建或退休子树使旧事件身份失效。FFI 可以保留类型化候选输入以连接回调和已发布 handle，但不创建原生实例、不预测 handle，候选缓存必须随失败撤销。

TS 方法使用明确的参数类型；原生 reader 校验字段集合、类型及取值，不忽略未知字段。新增能力必须同时实现 TS 参数、JSValue 解码、原生语义、失效、生命周期和真实链路测试。源码定位与 authoring 契约见 [SFA 与模板写法](33-SFA与模板写法.md)。

下面包含最终设计示例。正式导出与签名统一见 [基础 API 形态](21-基础API形态.md)；阴影、InteractionState、pointerInput 等尚属后续能力。

# 便捷组合

```ts
M.then(other: Modifier)
M.if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier)
```

`M.if` 是 Earzu Chan 大人原创的语法糖，作用等同条件分支拼接 Modifier。

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
| background / border / alpha / shadow / drawBehind / drawWithContent / drawWithCache | Paint |
| clickable / hoverable / focusable / pointerInput | HitTest / Input |
| zIndex | Paint + HitTest |
| offset / translation / scale / rotation | Transform + Paint + HitTest |
| verticalScroll / horizontalScroll | Layout 或 Place + Paint + HitTest |

无法证明局部边界时，必须由 FramePlan 选择显式 full fallback，并记录原因。

# 尺寸与约束

```ts
M.width(100, 0)
M.height(40, 0)
M.size(100, 0)
M.size(100, 0, 40, 0)

M.requiredWidth(100, 0)
M.requiredHeight(40, 0)
M.requiredSize(100, 0)

M.widthIn({ minDp: 40, minPx: 0, maxDp: 200, maxPx: 0 })
M.heightIn({ minDp: 20, minPx: 0, maxDp: 80, maxPx: 0 })
M.sizeIn({ minWidth, maxWidth, minHeight, maxHeight })
M.defaultMinSize({ minWidthDp: 0, minWidthPx: 0, minHeightDp: 0, minHeightPx: 0 })

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
M.padding(8, 0)
M.padding({ horizontalDp: 8, horizontalPx: 0, verticalDp: 4, verticalPx: 0 })
M.padding({ startDp, startPx, topDp, topPx, endDp, endPx, bottomDp, bottomPx })
```

`padding` 改变子节点约束，并把子节点尺寸加回自身尺寸。不提供 `margin`，因为不需要。

# 位置与父布局数据

```ts
M.offset({ xDp: 4, xPx: 0, yDp: 0, yPx: 0 })
M.absoluteOffset({ xDp: 4, xPx: 0, yDp: 0, yPx: 0 })

M.align(Alignment.Center)
M.weight(1)
M.weight(1, { fill: true })
M.matchParentSize()
M.zIndex(10)
```

- `offset` 不改变测量尺寸，只影响放置位置。
- `align`、`weight`、`matchParentSize` 是父布局数据。
- `zIndex` 同时影响绘制顺序和默认命中顺序。同一链条中多个 `zIndex` 累加；同值保留父布局的放置顺序，命中从绘制的最后一项向前搜索。

# 背景、边框、裁剪

```ts
M.background(0xFF2C2C2C)
M.background(0xFF2C2C2C, rounded(8, 0))

M.border(1, 0, 0xFF606060)
M.border(1, 0, 0xFF606060, rounded(8, 0))

M.clip(rounded(8, 0))
```

`background` 与 `border` 绘制在对应 Modifier 层的尺寸内。`clip` 裁剪后续绘制，不改变布局尺寸；命中也受该层精确形状约束，矩形、圆形/椭圆及圆角矩形分别按对应形状判断。每层 clip 在其局部坐标中判断，沿命中路径共同生效。

普通容器默认不裁剪子内容。子节点、阴影、显式绘制、图层变换等可以在视觉上超出父容器 bounds；最终仍受祖先显式 clip、滚动 viewport clip 与宿主窗口根裁剪影响。

`clip` 是显式视觉裁剪，语义接近 Compose 的 `clip` / `clipToBounds` / `graphicsLayer(clip = true)`：只有用户声明裁剪、滚动容器建立 viewport 或根宿主裁剪时，才应裁掉视觉超出。不得把所有父容器都实现成默认 clip。

`clip` 必须保留 Modifier 顺序语义：

```ts
M.background(red).clip(rounded(8, 0)).background(blue)
M.clip(rounded(8, 0)).background(red)
```

以上链条的绘制顺序和裁剪作用范围不同，不能被折叠成同一种效果。

# 阴影

主推设计工具式阴影：

```ts
M.dropShadow({
    shape: rounded(8, 0),
    radiusDp: 12,
    radiusPx: 0,
    spreadDp: 2,
    spreadPx: 0,
    offset: { xDp: 0, xPx: 0, yDp: 4, yPx: 0 },
    color: 0x66000000,
})

M.innerShadow({
    shape: rounded(8, 0),
    radiusDp: 8,
    radiusPx: 0,
    spreadDp: 1,
    spreadPx: 0,
    offset: { xDp: 0, xPx: 0, yDp: 2, yPx: 0 },
    color: 0x33000000,
})
```

注意：我们不采用 `M.shadow(elevation)`，这和设计工具不接轨，太和 Material 捆绑，不进入核心 API。

# 绘制

```ts
M.drawBehind((scope) => {
  scope.drawRect({ color: 0xFF202020 })
})
M.drawWithContent((scope, drawContent) => {
  scope.clipRoundRect({ radius: 8 }, () => drawContent())
})
M.drawWithCache((cache) => ({
  onDrawBehind(scope) {
    scope.drawCircle({ color: 0xFF202020, radius: cache.size.height / 2 })
  },
}))
```

`DrawScope.size` 是当前候选中该 Modifier 层的只读尺寸。所有绘制坐标、尺寸、半径、线宽和平移使用 JUCE 逻辑 PX；纯 TS 传数字，SFA 使用 `.px` 或声明为 PX 的值，颜色按既有 `Color(...)` 值契约编写。需要 DP/SP 换算时显式读取 Density，不由绘制作用域隐式推断单位。

作用域提供纯色 `drawRect`、`drawRoundRect`、`drawOval`、`drawCircle` 和 `drawLine`。形状参数包含 `color` 与可选 `strokeWidth`，形状的线宽为零表示填充；线条默认线宽为 1，必须大于零。矩形默认从 `(0, 0)` 填满当前层；圆形默认中心在当前层中心，半径为较短边的一半。圆角矩形另需 `radius`。坐标、尺寸和变换须有限，尺寸、半径和线宽不得为负数。

`clipRect`、`clipRoundRect`、`clipOval` 及 `withTransform` 接收嵌套同步回调，退出时恢复前一绘制状态。变换支持 `translationX/Y`、`scaleX/Y`、`rotationZ` 及比例原点 `originX/Y`（默认中心）。这些局部绘制状态只影响绘制，不改布局或输入几何；需要移动交互范围时使用 `graphicsLayer`。作用域在回调返回后失效，不能保留后异步调用。

`drawBehind` 在后续内容前绘制，并自动保留一次内容。`drawWithContent` 的 `drawContent()` 可调用零次、一次或多次，每次在当时 clip/transform 状态下绘制同一后续内容；零次隐藏后续绘制，不删除布局或交互节点。输入光标与选区覆盖层遵守同一内容次数和绘制状态。实现通过共享内容片段引用保存这些调用，不能复制后续节点或逐条重建其绘制命令。

`drawWithCache` 构建函数可返回 `onDrawBehind`、`onDrawWithContent` 或两者；前者先执行，后者控制内容，未提供后者时默认绘制一次内容。缓存归最终 Layout 的对应 Modifier 实例所有；层尺寸变化或构建函数读取的响应式依赖变化时重建，绘制回调自身读取的依赖只刷新绘制命令。构建和绘制分别追踪依赖，显式读取 Density 时其变化自然进入对应依赖。keyed 移动保留缓存，替换回调、移除或退休释放缓存和订阅；内容停用冻结工作，恢复读取最新值。失败候选恢复已发布缓存及订阅，不泄漏候选依赖。

全部回调在统一候选的绘制准备阶段同步执行，应只读取状态并录制绘制，不能产生事件、改变响应式状态或异步工作。准备将命令解码为原生类型化不可变片段，JUCE `paint()` 只重放；尺寸更新与录制属于同一候选，失败遵守 [统一发布边界](26-调度线程与帧阶段.md)。更完整的路径、渐变、文字、图片及通用 Canvas 能力在独立绘图 API 中定义。

# 图层与变换

```ts
M.alpha(0.5)
M.graphicsLayer({
  alpha: 0.8,
  scaleX: 1,
  scaleY: 1,
  rotationZ: 0,
  translationX: 0,
  translationY: 0,
  transformOrigin: TransformOrigin.Center,
  clip: false,
})
```

图层变换不改变测量尺寸；绘制与命中消费同一层变换及裁剪，命中通过逆变换转换坐标。原点按当前层宽高计算，支持镜像和零缩放；不可逆变换不参与命中。重复图层按 Modifier 顺序组合，不合并为一次参数覆盖。`graphicsLayer.clip` 使用矩形裁剪，形状裁剪由独立 `M.clip(shape)` 表达。`alpha` 的逐操作透明度规则见 [渲染设计](05-渲染设计.md#片段发布与重放)。

# 输入与交互

通用交互走 Modifier；焦点视觉可由显式响应式状态驱动，核心不注入设计系统样式。

```ts
const focused = ref(false)

const modifier = computed(() =>
  M.background(normalBg)
   .border(focused.value ? 2 : 1, 0, focused.value ? focusColor : outline)
   .onFocusChanged(state => { focused.value = state.isFocused })
   .clickable(onClick)
)
```

```ts
M.clickable(() => {})
M.clickable({
  enabled: true,
  onClick,
  focusable: true,
})

M.hoverable({ enabled: true })
M.focusable({ enabled: true })
M.focusRequester(requester)
M.onFocusChanged((state) => {})
M.focusProperties({ canFocus, next, previous, up, down, left, right })
M.focusGroup()

```

完整 `InteractionState`、hover 的 onEnter/onExit、onDoubleClick/onLongClick、role 与低级 `pointerInput` 回调仍是后续设计，当前不接受这些参数或构造器。

语义：

- `clickable` 默认可获得焦点，支持鼠标左键、Enter、Space 激活。
- `clickable` 的 press / focus 由原生 Owner 维护；当前可用 `onFocusChanged` 观察 `{isFocused,hasFocus}`。完整 `InteractionState` 仍是后续设计。
- `hoverable` 只处理进入 / 离开；连续 hover move 用 `pointerInput`。
- `focusable` 加入焦点遍历；`focusRequester` 提供程序化请求焦点。
- `focusGroup` 影响方向焦点搜索，不改变布局、绘制或命中。
- 程序化焦点的成功发布、请求器生命周期、父级 hasFocus、遍历/几何与 Lazy 按需导航规则见 [事件与输入](17-事件与输入.md#focus)。
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

滚动范围是布局输出：视口或内容尺寸变化后，实际偏移在本次放置中限制到合法范围，绘制和命中使用同一结果。只有成功发布的布局快照才回传 ScrollState；值、范围、视口尺寸、内容尺寸及可滚动方向按一组反应式状态交付。Modifier 的输入只订阅请求偏移和回传接口，不把范围等布局输出反向当作输入。反馈引出的后续视觉变化进入下一候选，不在发布调用栈里重跑流水线。

`scrollable` 是手势型滚动：只接收滚动 delta，不自动移动内容；适合自定义控件、Canvas、旋钮轨道等。

普通滚动会创建完整子树，适合设置页、短表单、小面板。大型集合使用 Lazy Arrangable。

同方向普通滚动嵌套 Lazy 或另一个同向滚动容器时，开发期给出诊断。运行期规则：滚动会话从初始落点沿祖先链选择并锁定目标，详见 [事件与输入](17-事件与输入.md)。

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
