# 目标

冻结基础 API / DSL 的公开形态、默认值和关键行为。若与其他文档冲突，以本文件为准。

# TypeScript 原则

`@arrange/runtime` 必须提供完整类型声明，服务智能提示。

runtime / tooling 新源码以 TypeScript 为主。`.mjs` 未来都要迁移成 `.ts`，新增生产源码优先 `.ts`。

JS/TS 代码样式：

- 不加行末分号。
- 不把多行逻辑压成一行。
- 缩进 4。
- 类型声明由 TS 源码生成，避免长期手写巨型 `.d.ts`。

```json
{
  "name": "@arrange/runtime",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    }
  }
}
```

需要导出：所有内建组件、组件 Props 类型、`Modifier`、`Dp`、`Sp`、`Px`、`ArrangeColor`、`Brush`、`Shape`、`PaddingValues`、`Alignment`、`Arrangement`、`ContentScale`、`InputState`、`DrawScope`、`InteractionState`、`FocusRequester`、`FocusState`、`FocusManager`、`Role`、`Orientation`、`ScrollState`、`LazyListState`、`LazyGridState`、`GridCells`、`GridItemSpan`。

# Authoring 入口

正式 authoring 路径是 Vue SFC / Vue render function：

```txt
Vue SFC / Vue render function
-> Vue custom renderer
-> Arrange host nodes
-> Bridge
```

`@arrange/runtime` 不公开自研 `h` 作为主 API。若测试仍需轻量 vnode helper，应放在 `@arrange/runtime/test` 或内部模块，并明确不属于生产 authoring。

# C++ App source 配置

推荐入口：

```cpp
arrange::juce::EditorConfig config;

config.app.useDist("../ui");
config.app.useLive();

return new arrange::juce::ArrangeEditor(*this, std::move(config));
```

API：

```cpp
config.app.useDist();
config.app.useDist("../ui");
config.app.useLive();
config.app.useLive("http://host:port");
```

规则：

- `useLive()` 缺省地址为 `http://127.0.0.1:9178`。
- `useDist()` 缺省目录为约定 `ui/` 产物包目录。
- Debug Demo 推荐 live + dist，按 live-first fallback 到 dist。
- Release 推荐只配置 dist。
- 未配置任何 source 时必须报错，不静默猜测。

# 单位

```ts
dp(value: number): Dp
sp(value: number): Sp
px(value: number): Px
```

`Dp`、`Sp`、`Px` 在 TypeScript 层使用 branded number。运行时尽量保持 number，避免额外对象开销。

- `dp`：JUCE 逻辑坐标。
- `sp`：文本字号单位。
- `px`：物理像素单位，主要用于 Canvas、位图和高级缓存。

# Color

```ts
Color(value: number): ArrangeColor
Color(args: { red: number; green: number; blue: number; alpha?: number }): ArrangeColor
```

整数格式固定为 `0xAARRGGBB`。`Color(0xFFFFFF)` 的 alpha 为 0，不自动补不透明。

# Brush

```ts
solidColor(color: ArrangeColor): Brush

linearGradient(args: {
  colors: ArrangeColor[] | ColorStop[]
  start?: Offset
  end?: Offset
  tileMode?: TileMode
}): Brush

radialGradient(args: {
  colors: ArrangeColor[] | ColorStop[]
  center?: Offset
  radius?: Dp
  tileMode?: TileMode
}): Brush
```

`background`、`border` 与 Canvas 绘制应接受 `ArrangeColor | Brush`。

# Shape

```ts
RectangleShape
CircleShape
rounded(radius: Dp): Shape
rounded(args: {
  topStart?: Dp
  topEnd?: Dp
  bottomEnd?: Dp
  bottomStart?: Dp
}): Shape
```

核心先支持矩形、圆、圆角矩形。复杂 path shape 后置。

# Modifier 基础

`m` 是空 Modifier，也是工厂入口。

```ts
m.then(other: Modifier): Modifier
m.if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier): Modifier
```

Modifier 顺序敏感，左侧先包裹右侧。

# Padding

```ts
m.padding(all: Dp): Modifier
m.padding(args: { horizontal?: Dp; vertical?: Dp }): Modifier
m.padding(args: { start?: Dp; top?: Dp; end?: Dp; bottom?: Dp }): Modifier
```

默认使用 `start/end`，不主推 `left/right`。若未来支持 `left/right`，它们必须定义为 absolute，不随布局方向变化。

# Background

```ts
m.background(brush: ArrangeColor | Brush): Modifier
m.background(brush: ArrangeColor | Brush, shape: Shape): Modifier
```

只绘制，不改变 layout。

# Border

```ts
m.border(width: Dp, brush: ArrangeColor | Brush): Modifier
m.border(width: Dp, brush: ArrangeColor | Brush, shape: Shape): Modifier
m.border(args: {
  width: Dp
  brush: ArrangeColor | Brush
  shape?: Shape
  align?: "inside" | "center" | "outside"
}): Modifier
```

默认 `align = "inside"`。`outside` 不改变 layout，但会扩大 repaint bounds。

# Shadow

采用设计工具式阴影，不采用 Material elevation。

```ts
m.dropShadow(args: {
  color: ArrangeColor
  offset?: DpOffset
  radius: Dp
  spread?: Dp
  shape?: Shape
}): Modifier

m.innerShadow(args: {
  color: ArrangeColor
  offset?: DpOffset
  radius: Dp
  spread?: Dp
  shape?: Shape
}): Modifier
```

# Clip

```ts
m.clip(shape: Shape): Modifier
```

裁剪后续绘制，不改变 layout。命中测试要考虑 transform；形状精确命中后续可细化。

# Size / Constraints

```ts
m.width(value: Dp | IntrinsicSize): Modifier
m.height(value: Dp | IntrinsicSize): Modifier

m.size(size: Dp): Modifier
m.size(width: Dp, height: Dp): Modifier

m.requiredWidth(width: Dp): Modifier
m.requiredHeight(height: Dp): Modifier
m.requiredSize(size: Dp): Modifier
m.requiredSize(width: Dp, height: Dp): Modifier

m.widthIn(args: { min?: Dp; max?: Dp }): Modifier
m.heightIn(args: { min?: Dp; max?: Dp }): Modifier
m.sizeIn(args: { minWidth?: Dp; maxWidth?: Dp; minHeight?: Dp; maxHeight?: Dp }): Modifier

m.defaultMinSize(args: { minWidth?: Dp; minHeight?: Dp }): Modifier

m.fillMaxWidth(fraction?: number): Modifier
m.fillMaxHeight(fraction?: number): Modifier
m.fillMaxSize(fraction?: number): Modifier

m.wrapContentWidth(align?: Alignment.Horizontal, unbounded?: boolean): Modifier
m.wrapContentHeight(align?: Alignment.Vertical, unbounded?: boolean): Modifier
m.wrapContentSize(align?: Alignment, unbounded?: boolean): Modifier

m.aspectRatio(ratio: number, matchHeightConstraintsFirst?: boolean): Modifier
```

默认值：`fillMax*` 的 `fraction = 1`；`wrapContentWidth` 默认 `Alignment.CenterHorizontally`；`wrapContentHeight` 默认 `Alignment.CenterVertically`；`wrapContentSize` 默认 `Alignment.Center`；`unbounded = false`；`aspectRatio(..., false)` 默认优先匹配宽度约束。

`fraction` 必须在 `0..1`，开发期越界诊断。

# IntrinsicSize

```ts
IntrinsicSize.Min
IntrinsicSize.Max
```

可用于 `m.width(...)` 与 `m.height(...)`。

# Position / ParentData

```ts
m.offset(args: { x?: Dp; y?: Dp }): Modifier
m.absoluteOffset(args: { x?: Dp; y?: Dp }): Modifier
m.zIndex(value: number): Modifier

m.align(alignment): Modifier
m.weight(weight: number, args?: { fill?: boolean }): Modifier
m.matchParentSize(): Modifier
```

`offset` 不改变测量尺寸，只影响放置位置。`weight > 0`，开发期越界诊断。`fill = true` 为默认值。

# Transform

```ts
m.alpha(value: number): Modifier
m.graphicsLayer(args: {
  alpha?: number
  scaleX?: number
  scaleY?: number
  rotationZ?: number
  translationX?: Dp
  translationY?: Dp
  transformOrigin?: TransformOrigin
  clip?: boolean
  shape?: Shape
}): Modifier
```

图层变换不改变测量尺寸，但必须影响绘制与命中测试。

# Draw Modifier

```ts
m.drawBehind(draw: (scope: DrawScope) => void): Modifier
m.drawWithContent(draw: (scope: DrawScope, drawContent: () => void) => void): Modifier
m.drawWithCache(build: (cache: DrawCacheScope) => DrawCacheResult): Modifier
```

`drawWithCache` 仅在尺寸或依赖数据变化时重建缓存。

# Interaction Modifier

```ts
rememberInteractionState(): InteractionState
rememberFocusRequester(): FocusRequester
useFocusManager(): FocusManager

interface InteractionState {
  readonly hovered: boolean
  readonly pressed: boolean
  readonly focused: boolean
  readonly enabled: boolean
}

m.clickable(onClick: () => void): Modifier
m.clickable(args: {
  enabled?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onLongClick?: () => void
  interactionState?: InteractionState
  role?: Role
  focusable?: boolean
}): Modifier

m.hoverable(args?: {
  enabled?: boolean
  interactionState?: InteractionState
  onEnter?: () => void
  onExit?: () => void
}): Modifier

m.focusable(enabled?: boolean): Modifier
m.focusable(args: {
  enabled?: boolean
  interactionState?: InteractionState
}): Modifier

m.focusRequester(requester: FocusRequester): Modifier
m.onFocusChanged(callback: (state: FocusState) => void): Modifier
m.focusProperties(args: {
  canFocus?: boolean
  next?: FocusRequester
  previous?: FocusRequester
  up?: FocusRequester
  down?: FocusRequester
  left?: FocusRequester
  right?: FocusRequester
}): Modifier
m.focusGroup(): Modifier

m.pointerInput(handler: (scope: PointerInputScope) => void): Modifier
```

默认视觉不随 hover / focus / press 自动变化；核心不提供 ripple、伪类或设计系统样式。用户用 `InteractionState` 组合响应式 Modifier：

```ts
const interaction = rememberInteractionState()

const mod = computed(() =>
  m.background(interaction.hovered ? hoverBg : bg)
   .border(interaction.focused ? dp(2) : dp(1), interaction.focused ? primary : outline)
   .clickable({ interactionState: interaction, onClick })
)
```

语义：

- `clickable` 默认 `enabled=true`，默认左键点击，默认 `focusable=true`。
- `clickable` 隐含 hover / press / keyboard activate 语义；Enter 与 Space 触发 `onClick`。
- `clickable` 的 `onClick` 在 pointer up 且仍命中时触发；拖出后释放不触发。
- `hoverable` 只表达进入 / 离开与 hover 状态；连续移动用 `pointerInput`。
- `focusable(false)` 表示不能通过键盘焦点遍历获得焦点，但不等于禁用点击。
- `focusGroup` 只影响焦点搜索顺序，不改变 layout。
- 高级语义优先由 C++ 识别，不把全部鼠标事件交给 JS。

# Scroll Modifier

```ts
rememberScrollState(args?: { initial?: Dp }): ScrollState

interface ScrollState {
  readonly value: Dp
  readonly maxValue: Dp
  readonly viewportSize: Dp
  readonly contentSize: Dp
  readonly isScrollInProgress: boolean
  readonly canScrollBackward: boolean
  readonly canScrollForward: boolean
  scrollTo(value: Dp): void
  animateScrollTo(value: Dp): void
}

m.verticalScroll(state: ScrollState, args?: {
  enabled?: boolean
  reverseScrolling?: boolean
  overscroll?: boolean
}): Modifier

m.horizontalScroll(state: ScrollState, args?: {
  enabled?: boolean
  reverseScrolling?: boolean
  overscroll?: boolean
}): Modifier

m.scrollable(state: ScrollableState, orientation: Orientation, args?: {
  enabled?: boolean
  reverseDirection?: boolean
}): Modifier
```

`verticalScroll` / `horizontalScroll` 会裁剪 viewport、偏移内容并更新 `ScrollState`。`scrollable` 是低级滚动手势通道，不自动移动内容。

普通滚动会创建全部子树，适合小型内容；大型集合使用 Lazy 组件。不得在同方向把 `verticalScroll` 套在 `LazyColumn` 外做双重主滚动；开发期诊断。

# Lazy State

```ts
rememberLazyListState(args?: {
  initialFirstVisibleItemIndex?: number
  initialFirstVisibleItemScrollOffset?: Dp
}): LazyListState

interface LazyListState {
  readonly firstVisibleItemIndex: number
  readonly firstVisibleItemScrollOffset: Dp
  readonly visibleItemsInfo: LazyItemInfo[]
  readonly totalItemsCount: number
  readonly viewportStartOffset: Dp
  readonly viewportEndOffset: Dp
  readonly isScrollInProgress: boolean
  readonly canScrollBackward: boolean
  readonly canScrollForward: boolean
  scrollToItem(index: number, scrollOffset?: Dp): void
  animateScrollToItem(index: number, scrollOffset?: Dp): void
}

rememberLazyGridState(args?: {
  initialFirstVisibleItemIndex?: number
  initialFirstVisibleItemScrollOffset?: Dp
}): LazyGridState
```

Lazy 状态由 C++ 滚动与测量系统维护，按需镜像给 JS；只有 JS 读取状态或注册回调时才跨 Bridge 同步。

# LazyColumn / LazyRow

```ts
interface LazyColumnProps<T> {
  modifier?: Modifier
  items: readonly T[]
  itemKey?: (item: T, index: number) => string | number
  itemContentType?: (item: T, index: number) => string | number | undefined
  state?: LazyListState
  contentPadding?: PaddingValues | Dp
  verticalArrangement?: Arrangement.Vertical
  horizontalAlignment?: Alignment.Horizontal
  reverseLayout?: boolean
  userScrollEnabled?: boolean
  beyondBoundsItemCount?: number
}

interface LazyRowProps<T> {
  modifier?: Modifier
  items: readonly T[]
  itemKey?: (item: T, index: number) => string | number
  itemContentType?: (item: T, index: number) => string | number | undefined
  state?: LazyListState
  contentPadding?: PaddingValues | Dp
  horizontalArrangement?: Arrangement.Horizontal
  verticalAlignment?: Alignment.Vertical
  reverseLayout?: boolean
  userScrollEnabled?: boolean
  beyondBoundsItemCount?: number
}
```

Vue 写法：

```vue
<LazyColumn :items="tracks" :item-key="track => track.id">
  <template #item="{ item, index }">
    <TrackRow :track="item" />
  </template>
</LazyColumn>
```

Lazy 组件只物化可视范围、预取范围与焦点保持所需项目。`itemKey` 是状态保持边界；不提供时使用 index，开发期在增删/重排时警告。

# Lazy Grid

```ts
GridCells.Fixed(count: number): GridCells
GridCells.Adaptive(minSize: Dp): GridCells
GridItemSpan(count: number): GridItemSpan
GridItemSpan.MaxLineSpan: GridItemSpan

interface LazyVerticalGridProps<T> {
  modifier?: Modifier
  columns: GridCells
  items: readonly T[]
  itemKey?: (item: T, index: number) => string | number
  itemContentType?: (item: T, index: number) => string | number | undefined
  itemSpan?: (item: T, index: number) => GridItemSpan | number
  state?: LazyGridState
  contentPadding?: PaddingValues | Dp
  verticalArrangement?: Arrangement.Vertical
  horizontalArrangement?: Arrangement.Horizontal
  userScrollEnabled?: boolean
  beyondBoundsItemCount?: number
}

interface LazyHorizontalGridProps<T> {
  modifier?: Modifier
  rows: GridCells
  items: readonly T[]
  itemKey?: (item: T, index: number) => string | number
  itemContentType?: (item: T, index: number) => string | number | undefined
  itemSpan?: (item: T, index: number) => GridItemSpan | number
  state?: LazyGridState
  contentPadding?: PaddingValues | Dp
  horizontalArrangement?: Arrangement.Horizontal
  verticalArrangement?: Arrangement.Vertical
  userScrollEnabled?: boolean
  beyondBoundsItemCount?: number
}
```

Grid 不保证 masonry / 瀑布流；不同高度项目按行/列最大尺寸对齐。

# Alignment

```ts
Alignment.TopStart
Alignment.TopCenter
Alignment.TopEnd
Alignment.CenterStart
Alignment.Center
Alignment.CenterEnd
Alignment.BottomStart
Alignment.BottomCenter
Alignment.BottomEnd

Alignment.Start
Alignment.CenterHorizontally
Alignment.End

Alignment.Top
Alignment.CenterVertically
Alignment.Bottom
```

# Arrangement

```ts
Arrangement.Start
Arrangement.Center
Arrangement.End
Arrangement.SpaceBetween
Arrangement.SpaceAround
Arrangement.SpaceEvenly
Arrangement.spacedBy(space: Dp)
Arrangement.spacedBy(space: Dp, alignment: Alignment.Horizontal | Alignment.Vertical)
```

# Box

```ts
interface BoxProps {
  modifier?: Modifier
  contentAlignment?: Alignment
  propagateMinConstraints?: boolean
}
```

默认 `contentAlignment = Alignment.TopStart`，`propagateMinConstraints = false`。

BoxScope Modifier：

```ts
m.align(alignment: Alignment)
m.matchParentSize()
```

# Row

```ts
interface RowProps {
  modifier?: Modifier
  horizontalArrangement?: Arrangement.Horizontal
  verticalAlignment?: Alignment.Vertical
}
```

默认 `horizontalArrangement = Arrangement.Start`，`verticalAlignment = Alignment.Top`。

RowScope Modifier：

```ts
m.weight(weight: number, args?: { fill?: boolean })
m.align(alignment: Alignment.Vertical)
```

# Column

```ts
interface ColumnProps {
  modifier?: Modifier
  verticalArrangement?: Arrangement.Vertical
  horizontalAlignment?: Alignment.Horizontal
}
```

默认 `verticalArrangement = Arrangement.Top`，`horizontalAlignment = Alignment.Start`。

ColumnScope Modifier：

```ts
m.weight(weight: number, args?: { fill?: boolean })
m.align(alignment: Alignment.Horizontal)
```

# Scope 错误

父布局数据用错 scope 时开发期诊断。Release 可忽略该 parent data。

# Image

```ts
type ImageSource = string | { uri: string }

interface ImageProps {
  modifier?: Modifier
  source: ImageSource
  contentScale?: ContentScale
  alignment?: Alignment
  alpha?: number
  tint?: ArrangeColor
  contentDescription?: string
}
```

默认 `contentScale = ContentScale.Fit`，`alignment = Alignment.Center`，`alpha = 1`，`tint = undefined`。

# ContentScale

```ts
ContentScale.Fit
ContentScale.Crop
ContentScale.FillBounds
ContentScale.Inside
ContentScale.None
ContentScale.FillWidth
ContentScale.FillHeight
```

# Icon

核心 Icon 面向单色 SVG。

```ts
type IconSource = string | { svg: string }

interface IconProps {
  modifier?: Modifier
  source: IconSource
  size?: Dp
  tint?: ArrangeColor
  contentDescription?: string
}
```

默认 `size = dp(24)`，`tint = Color(0xFF000000)`。多色 SVG 不作为核心承诺；复杂图形使用 `Image` 或 `Canvas`。

# Bridge Header

进入 command buffer 后使用：

```txt
magic = 0x0d000721
version = 1
flags
opCount
```

Magic 仅属于内部小惊喜，用于极简验证目的。
