# 基础 API 形态

本文只记录公开 API 的名称、签名、默认值和导出边界。行为语义分别归属其它母文档：基础类型见 [基础类型](10-基础类型.md)，布局见 [布局](09-布局.md)，Modifier 见 [Modifier](11-Modifier.md)，组件行为见 [内建组件](12-内建组件.md)，事件见 [事件与输入](17-事件与输入.md)，文本与输入见 [文本输入与绘制](18-文本输入与绘制.md)，动画与 transition 见 [动画与Transition](28-动画与Transition.md)。

# TypeScript 包

```json
{
  "name": "@arrange/framework",
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts"
    }
  }
}
```

`@arrange/framework` 以 TS-first 方式发布。源码与代码风格要求见 `../proj/5：具体开发的额外约束.md`。

# Authoring 入口

```ts
import { createApp } from "@arrange/framework"
import App from "./App.vue"

createApp(App).mount()
```

正式 authoring 路径：

```txt
Vue SFC / template / render function
-> Arrange Vue compiler / runtime
-> Composition mutations + Reactive slot updates
-> QuickJS native boundary
-> MutationTransaction / SlotUpdateBatch
```

`@arrange/framework` 是用户导入 Arrange UI API 与 Arrange Vue authoring API 的主入口。测试 helper 若需要 vnode 入口，应放在 test/internal 范围。

# C++ App source

```cpp
arrange::juce::EditorConfig config;

config.app.useDist();
config.app.useLive();

return new arrange::juce::ArrangeEditor(*this, std::move(config));
```

```cpp
config.app.useDist();
config.app.useDist("ui");
config.app.useLive();
config.app.useLive("http://host:port");
```

规则见 [App入口](02-App入口.md)。

# 导出总表

`@arrange/framework` 至少导出：

```ts
createApp

ref
reactive
computed
watch
watchEffect
onMounted
onUnmounted
nextTick

Box
Row
Column
Spacer
Text
Input
Image
Icon
Canvas
FlowRow
FlowColumn
LazyColumn
LazyRow
LazyVerticalGrid
LazyHorizontalGrid

m
Modifier

dp
sp
px
Color
solidColor
linearGradient
radialGradient
rounded

Alignment
Arrangement
IntrinsicSize
ContentScale
Role
Orientation
GridCells
GridItemSpan

rememberInputState
rememberCanvasController

animatedNumberAsRef
animatedDpAsRef
animatedColorAsRef
animatedOffsetAsRef
animatedSizeAsRef
animatedRectAsRef
animatedNumberArrayAsRef
transition

rememberInteractionState
rememberFocusRequester
useFocusManager
rememberScrollState
rememberLazyListState
rememberLazyGridState

useParameter
useHost
useTransport

logger
diagnostics

LocalContentColor
LocalTextStyle
LocalDensity
LocalLayoutDirection
provideArrangeLocal
useArrangeLocal
provideContentColor
useContentColor
```

# 基础类型 API

```ts
dp(value: number): Dp
sp(value: number): Sp
px(value: number): Px

Color(value: number): ArrangeColor
Color(args: { red: number; green: number; blue: number; alpha?: number }): ArrangeColor
Color.Unspecified: ArrangeColor

solidColor(color: ArrangeColor): Brush
linearGradient(args: LinearGradientArgs): Brush
radialGradient(args: RadialGradientArgs): Brush
rounded(radius: Dp): Shape
rounded(args: { topStart?: Dp; topEnd?: Dp; bottomEnd?: Dp; bottomStart?: Dp }): Shape
```

`Dp`、`Sp`、`Px` 在 TypeScript 层使用 branded number。运行时尽量保持 number，避免额外对象开销。

# Modifier API

```ts
interface Modifier {
    then(other?: Modifier): Modifier
    if(condition: boolean, block: (m: Modifier) => Modifier): Modifier

    width(value: Dp | IntrinsicSize): Modifier
    height(value: Dp | IntrinsicSize): Modifier
    size(value: Dp): Modifier
    widthIn(args: ConstraintRange): Modifier
    heightIn(args: ConstraintRange): Modifier
    sizeIn(args: SizeConstraintRange): Modifier
    requiredWidth(value: Dp): Modifier
    requiredHeight(value: Dp): Modifier
    requiredSize(value: Dp): Modifier
    fillMaxWidth(fraction?: number): Modifier
    fillMaxHeight(fraction?: number): Modifier
    fillMaxSize(fraction?: number): Modifier
    wrapContentWidth(alignment?: Alignment.Horizontal, unbounded?: boolean): Modifier
    wrapContentHeight(alignment?: Alignment.Vertical, unbounded?: boolean): Modifier
    wrapContentSize(alignment?: Alignment, unbounded?: boolean): Modifier
    aspectRatio(ratio: number, matchHeightConstraintsFirst?: boolean): Modifier

    padding(value: Dp | PaddingValues): Modifier
    offset(x: Dp, y?: Dp): Modifier
    align(alignment: Alignment): Modifier
    weight(value: number, fill?: boolean): Modifier
    matchParentSize(): Modifier
    zIndex(value: number): Modifier

    background(color: ArrangeColor | Brush, shape?: Shape): Modifier
    border(width: Dp, color: ArrangeColor | Brush, shape?: Shape): Modifier
    clip(shape: Shape): Modifier
    shadow(args: ShadowArgs): Modifier
    alpha(value: number): Modifier
    graphicsLayer(args: GraphicsLayerArgs): Modifier

    drawBehind(block: DrawBlock): Modifier
    drawWithContent(block: DrawWithContentBlock): Modifier
    drawWithCache(block: DrawWithCacheBlock): Modifier

    clickable(args: ClickableArgs | (() => void)): Modifier
    hoverable(args?: HoverableArgs): Modifier
    focusable(args?: FocusableArgs): Modifier
    pointerInput(key: unknown, handler: PointerInputHandler): Modifier
    verticalScroll(state?: ScrollState): Modifier
    horizontalScroll(state?: ScrollState): Modifier

    animateContentSize(args?: AnimateContentSizeArgs): Modifier
}
```

Modifier 顺序与阶段语义见 [Modifier](11-Modifier.md)。

# 组件 Props

## Box

```ts
interface BoxProps {
    modifier?: Modifier
    contentAlignment?: Alignment
    propagateMinConstraints?: boolean
}
```

## Row / Column

```ts
interface RowProps {
    modifier?: Modifier
    horizontalArrangement?: Arrangement.Horizontal
    verticalAlignment?: Alignment.Vertical
}

interface ColumnProps {
    modifier?: Modifier
    verticalArrangement?: Arrangement.Vertical
    horizontalAlignment?: Alignment.Horizontal
}
```

## Spacer

```ts
interface SpacerProps {
    modifier?: Modifier
}
```

## Text

```ts
interface TextProps {
    text?: string
    modifier?: Modifier
    color?: ArrangeColor
    fontSize?: Sp
    fontWeight?: FontWeight
    textAlign?: TextAlign
    maxLines?: number
    overflow?: TextOverflow
    style?: TextStyle
}
```

## Input

```ts
interface InputProps {
    modelValue?: string
    state?: InputState
    modifier?: Modifier
    placeholder?: string
    commitMode?: "change" | "blur" | "submit"
    enabled?: boolean
    readOnly?: boolean
    singleLine?: boolean
    style?: TextStyle
    onUpdateModelValue?: (value: string) => void
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
    onFocusChange?: (focused: boolean) => void
}
```

## Image / Icon

```ts
interface ImageProps {
    source: string | ImageResource
    modifier?: Modifier
    contentScale?: ContentScale
    alignment?: Alignment
    contentDescription?: string
}

interface IconProps {
    source: string | IconResource
    modifier?: Modifier
    tint?: ArrangeColor
    size?: Dp
    contentDescription?: string
}
```

`ImageResource` / `IconResource` 可由 Vite import、`new URL(..., import.meta.url)` 或 Arrange Vite 插件规范化产生。字符串资源路径按 UI package root 解析。Icon 初期只承诺 SVG 子集，且核心不内建官方图标包。行为见 [内建组件](12-内建组件.md) 与 [工具链与App发布包](14-工具链与App发布包.md)。

## Canvas

```ts
interface CanvasProps {
    modifier?: Modifier
    invalidation?: "auto" | "manual" | "frame"
    controller?: CanvasController
    onDraw: (scope: DrawScope) => void
}
```

Canvas 行为见 [文本输入与绘制](18-文本输入与绘制.md) 与 [内建组件](12-内建组件.md)。

## Flow

```ts
interface FlowRowProps {
    modifier?: Modifier
    horizontalArrangement?: Arrangement.Horizontal
    verticalArrangement?: Arrangement.Vertical
    maxItemsInEachRow?: number
}

interface FlowColumnProps {
    modifier?: Modifier
    verticalArrangement?: Arrangement.Vertical
    horizontalArrangement?: Arrangement.Horizontal
    maxItemsInEachColumn?: number
}
```

## Lazy list

```ts
interface LazyColumnProps<T> {
    items: T[]
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
    items: T[]
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

## Lazy grid

```ts
interface LazyVerticalGridProps<T> {
    items: T[]
    columns: GridCells
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
    items: T[]
    rows: GridCells
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
```

Lazy 行为见 [内建组件](12-内建组件.md)。

# 动画 API

```ts
animatedNumberAsRef(...): Ref<number>
animatedDpAsRef(...): Ref<Dp>
animatedColorAsRef(...): Ref<ArrangeColor>
animatedOffsetAsRef(...): Ref<Offset>
animatedSizeAsRef(...): Ref<Size>
animatedRectAsRef(...): Ref<Rect>
animatedNumberArrayAsRef(...): Ref<number[]>

transition(...): Transition
```

动画与 transition 行为见 [动画与Transition](28-动画与Transition.md)。调度语义见 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

# 状态 helper

```ts
rememberInteractionState(): InteractionState
rememberFocusRequester(): FocusRequester
useFocusManager(): FocusManager
rememberScrollState(initial?: number): ScrollState
rememberLazyListState(args?: LazyListStateArgs): LazyListState
rememberLazyGridState(args?: LazyGridStateArgs): LazyGridState
rememberInputState(initial?: string): InputState
rememberCanvasController(): CanvasController
```

# Interop hooks

```ts
useParameter(id: string): ParameterState
useHost(): HostState
useTransport(): TransportState
```

互操作语义见 [互操作](16-互操作.md)。

# Diagnostics API

```ts
type DiagnosticLevel = "trace" | "debug" | "info" | "warn" | "error"
type DiagnosticCategory =
    | "app"
    | "live"
    | "hmr"
    | "dist"
    | "transaction"
    | "script"
    | "layout"
    | "paint"
    | "input"
    | "scroll"
    | "resource"
    | "host"

logger.trace(category: DiagnosticCategory, message: string, detail?: unknown): void
logger.debug(category: DiagnosticCategory, message: string, detail?: unknown): void
logger.info(category: DiagnosticCategory, message: string, detail?: unknown): void
logger.warn(category: DiagnosticCategory, message: string, detail?: unknown): void
logger.error(category: DiagnosticCategory, message: string, detail?: unknown): void

diagnostics.toast(message: string, args?: DiagnosticToastArgs): void
diagnostics.warn(message: string, detail?: unknown): void
diagnostics.error(message: string, detail?: unknown): void
```

`logger` 与 `diagnostics.toast` 都进入 `DiagnosticEvent` 系统。行为见 [开发期诊断表层](25-开发期诊断表层.md)。

# Arrange Local API

```ts
interface ArrangeLocalKey<T> {
    readonly name: string
    readonly defaultValue: T
}

provideArrangeLocal<T>(key: ArrangeLocalKey<T>, value: T): void
useArrangeLocal<T>(key: ArrangeLocalKey<T>): T

provideContentColor(color: ArrangeColor): void
useContentColor(): ArrangeColor
```

内置 Local 与读取优先级见 [主题与扩展包](20-主题与扩展包.md)。

# Runtime Hello

若 runtime 与 native 之间需要版本检查，应在 QuickJS native runtime 初始化时传递最小握手信息：

```ts
interface RuntimeHello {
    frameworkInternalProtocolCode: number
    runtimeVersion: string
    appId?: string
}
```

生产 native transaction 细节见 [LayoutTree与NativeTransaction](15-LayoutTree与NativeTransaction.md)。




