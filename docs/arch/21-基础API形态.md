# 基础 API 形态

FUCK：这篇文章和很多文章有很多重复，真死妈了（违背我在 `docs/README.md`）树的规矩。

本文只记录公开 API 的名称、签名、默认值和导出边界。行为语义分别归属其它母文档：基础类型见 [基础类型](10-基础类型.md)，布局见 [布局](09-布局.md)，Modifier 见 [Modifier](11-Modifier.md)，Arrangable行为见 [内建 Arrangable](12-内建Arrangable.md)，事件见 [事件与输入](17-事件与输入.md)，文本与输入见 [文本输入与绘制](18-文本输入与绘制.md)，动画与 transition 见 [动画与Transition](28-动画与Transition.md)。

# TypeScript 包

`@arrange/framework` 以 TS-first 方式发布，能力分层入口及内部协议边界见 [内部包构建与分发契约](29-内部包构建与分发契约.md#入口分层与内部依赖)。

# Authoring 入口

```ts
import { createApp } from "@arrange/framework"
import App from "./App.sfa"

createApp(App).mount()
```

正式 authoring 路径：

```txt
SFA 模板与 TS setup
-> Arrange compiler / runtime
-> Rearrange mutations + Reactive slot updates
-> QuickJS native boundary
-> MutationTransaction / SlotUpdateBatch
```

`@arrange/framework` 根入口提供核心状态、生命周期、上下文与 App 能力；Foundation、UI 和动画从对应子入口导入。旧 VNode 及其构造 helper 没有公开、内部或测试专用保留入口。

用户通过 SFA 的 defineProps/withDefaults 声明参数，通过模板中的 Slot 声明内容。内建 FA 直接用代码编写，与 SFA 编译结果遵守同一种 Arrangable 定义和调用契约，见 [运行时](04-运行时.md)。参数、内容与错误行为见 [SFA 与模板写法](33-SFA与模板写法.md)。

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

# 基础类型 API

```sfa
// SFA 写法，编译期拆箱
114.dp
16.sp
8.px

Color(value: number): ArrangeColor
Color(args: { red: number; green: number; blue: number; alpha?: number }): ArrangeColor

solidColor(color: ArrangeColor): Brush
rounded(radiusDp: number, radiusPx: number): Shape
```

`Dp`、`Sp`、`Px` 是值壳类型，不是 number 别名。普通 TS 直接写真语义数字；SFA 的长度消费由编译器生成双通道数字。

# Modifier API

```ts
interface Modifier {
    then(other: Modifier | null | undefined): Modifier
    keyed(key: string): Modifier
    if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier): Modifier
    width(dp: number, px: number): Modifier
    height(dp: number, px: number): Modifier
    size(widthDp: number, widthPx: number, heightDp?: number, heightPx?: number): Modifier
    requiredWidth(dp: number, px: number): Modifier
    requiredHeight(dp: number, px: number): Modifier
    requiredSize(widthDp: number, widthPx: number, heightDp?: number, heightPx?: number): Modifier
    widthIn(args: { minDp?: number; minPx?: number; maxDp?: number; maxPx?: number }): Modifier
    heightIn(args: { minDp?: number; minPx?: number; maxDp?: number; maxPx?: number }): Modifier
    sizeIn(args: SizeRange): Modifier
    defaultMinSize(args: Pick<SizeRange, "minWidthDp" | "minWidthPx" | "minHeightDp" | "minHeightPx">): Modifier
    fillMaxWidth(fraction?: number): Modifier
    fillMaxHeight(fraction?: number): Modifier
    fillMaxSize(fraction?: number): Modifier
    padding(value: PaddingValue): Modifier
    offset(args: { xDp?: number; xPx?: number; yDp?: number; yPx?: number }): Modifier
    absoluteOffset(args: { xDp?: number; xPx?: number; yDp?: number; yPx?: number }): Modifier
    align(alignment: string): Modifier
    weight(weight: number, args?: { fill?: boolean }): Modifier
    zIndex(value: number): Modifier
    background(brush: Brush | number, shape?: Shape): Modifier
    paint(painter: Painter, options?: PaintOptions): Modifier
    border(args: BorderOptions): Modifier
    border(widthDp: number, widthPx: number, brush: Brush | number, shape?: Shape): Modifier
    clip(shape: Shape): Modifier
    alpha(value: number): Modifier
    graphicsLayer(args?: GraphicsLayerOptions): Modifier
    clickable(arg: (() => void) | ClickableOptions): Modifier
    hoverable(args?: EnabledOptions): Modifier
    focusable(arg?: boolean | EnabledOptions): Modifier
    verticalScroll(state: ScrollStateLike, args?: EnabledOptions): Modifier
    horizontalScroll(state: ScrollStateLike, args?: EnabledOptions): Modifier
    animateContentSize(animationSpec?: AnimationSpec, args?: { clip?: boolean }): Modifier
}
```

参数类型从 Framework 导出；GraphicsLayerOptions 只包含平移、缩放、rotationZ、alpha、矩形 clip 与 transformOrigin，ClickableOptions 包含 onClick、enabled、focusable，EnabledOptions 只包含 enabled。完整类型见包声明。阴影、渐变、自定义绘制、pointerInput 与程序化焦点为后续能力，目前不导出。

Modifier 顺序与阶段语义见 [Modifier](11-Modifier.md)。

# Arrangable Props

## Box

```ts
interface BoxProps {
    modifier?: Modifier
    contentAlignment?: BoxAlignment
    propagateMinConstraints?: boolean
    enabled?: boolean
    contentDescription?: string
}
```

## Row / Column

```ts
interface RowProps {
    modifier?: Modifier
    horizontalArrangement?: HorizontalArrangementProp
    verticalAlignment?: VerticalAlignment | 'Baseline'
}

interface ColumnProps {
    modifier?: Modifier
    verticalArrangement?: VerticalArrangementProp
    horizontalAlignment?: HorizontalAlignment
}
```

## Layout 与动态定义

Layout 接收必需的 measurePolicy: MeasurePolicy、modifier?: Modifier 及默认内容，默认 modifier 为 M。行为、交互与语义描述经正式 Modifier 组合交付，不附加 Foundation 专用输入。

预制策略为 BoxMeasurePolicy(options?)、RowMeasurePolicy(options?)、ColumnMeasurePolicy(options?)、MinSizeMeasurePolicy；前三者按显式参数构造值，后者为稳定策略值。文本测量归文本 Modifier，旧 TextMeasurePolicy 不作为 Layout 策略保留。策略语义见 [内建 Arrangable](12-内建Arrangable.md)。

DynamicArrangable 接收必需的 is: Arrangable 及 props?: Record<string, unknown>，默认参数对象为空。KeepAlive 接收必需的 cacheKey: string | number | bigint | symbol | null、max?: number 和默认内容；max 默认为 10，须为正整数。动态调用及缓存行为见 [运行时](04-运行时.md#动态调用与内容保留)。

## Spacer

```ts
interface SpacerProps {
    modifier?: Modifier
}
```

## Text

```ts
interface TextProps {
    modifier?: Modifier
    text?: string
    style?: TextStyleProp
    singleLine?: boolean
    minLines?: number
    maxLines?: number
    textAlign?: TextAlignment
    overflow?: 'clip' | 'ellipsis' | 'visible'
}
```

## Input

```ts
interface InputProps {
    modifier?: Modifier
    textStyle?: TextStyleProp
    singleLine?: boolean
    minLines?: number
    maxLines?: number
    value?: string
    placeholder?: string
    enabled?: boolean
    selectAllOnFocus?: boolean
    onValueChange?: (value: string) => void
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
    onBlur?: (value: string) => void
}
```

## Image / Icon

```ts
interface ImageProps {
    painter: Painter
    modifier?: Modifier
    contentScale?: ContentScaleValue
    alpha?: number
    alignment?: ImageAlignment
    contentDescription?: string
}

interface IconProps {
    painter: Painter
    modifier?: Modifier
    tint?: ArrangeColor
    contentDescription?: string
}
```

Painter 获取 API 为 painter(resource: string | {path: string}): Painter。Painter 提供只读 intrinsicSize、contentVersion、status、error 及 dispose()。业务通过 painter 取得能力对象再传入 Image/Icon；生命周期与绘制语义见 [内建 Arrangable](12-内建Arrangable.md)，路径约束见 [工具链与 App 发布包](14-工具链与App发布包.md)。

## 后续能力的签名草案

Canvas、Flow、Lazy、InputState、交互状态、焦点请求器及 Interop hooks 尚未形成完整的原生消费者，以下相关形态为后续设计，不属于当前可导入能力。只有所有权、提交、读取与退休链路俱全后才公开入口。

### Canvas

```ts
interface CanvasProps {
    modifier?: Modifier
    invalidation?: "auto" | "manual" | "frame"
    controller?: CanvasController
    onDraw: (scope: DrawScope) => void
}
```

Canvas 行为见 [文本输入与绘制](18-文本输入与绘制.md) 与 [内建 Arrangable](12-内建Arrangable.md)。

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

Lazy 行为见 [内建 Arrangable](12-内建Arrangable.md)。

# 动画 API

```ts
animatedNumberAsRef(...): AnimatedRef<number>
animatedDpAsRef(...): AnimatedRef<number>
animatedColorAsRef(...): AnimatedRef<number>
animatedOffsetAsRef(...): AnimatedRef<Offset>
animatedSizeAsRef(...): AnimatedRef<Size>
animatedRectAsRef(...): AnimatedRef<Rect>
animatedNumberArrayAsRef(...): AnimatedRef<readonly number[]>

transition(...): Transition
createInfiniteTransition(args?: { label?: string }): InfiniteTransition
```

AnimatedRef 为只读值，附带 isRunning、label 和 stop；DP、颜色及字段单位由正式参数契约确定，SFA 的值壳消融见 [基础类型](10-基础类型.md)。

动画与 transition 行为见 [动画与Transition](28-动画与Transition.md)。调度语义见 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

# 状态 helper

```ts
createScrollState(args?: {initial?: number}): ScrollState
```

在 setup 中创建一次即可。ScrollState 提供响应式 value、maxValue、viewportSize、contentSize、isScrollInProgress、canScrollBackward、canScrollForward，以及 scrollTo(value)。把对象交给 verticalScroll 后，原生滚动回执同步这些属性。其它状态 helper 属于后续设计，未以空壳函数导出。

# Interop hooks（后续设计）

```ts
useParameter(id: string): ParameterState
useHost(): HostState
useTransport(): TransportState
```

互操作语义见 [互操作](16-互操作.md)。

# Diagnostics API

```ts
Log.v(tag: string, ...args: unknown[]): void
Log.d(tag: string, ...args: unknown[]): void
Log.i(tag: string, ...args: unknown[]): void
Log.w(tag: string, ...args: unknown[]): void
Log.e(tag: string, ...args: unknown[]): void

DiagnosticsToast.v(tag: string, title: string, ...args: unknown[]): void
DiagnosticsToast.d(tag: string, title: string, ...args: unknown[]): void
DiagnosticsToast.i(tag: string, title: string, ...args: unknown[]): void
DiagnosticsToast.w(tag: string, title: string, ...args: unknown[]): void
DiagnosticsToast.e(tag: string, title: string, ...args: unknown[]): void

diagnostics.requestReload(path?: string): void
diagnostics.triggerFakeError(message?: string): void
diagnostics.setToastsEnabled(enabled: boolean): void
```

`Log` 是 Arrange 自有 C++ 与 hosted JS 的唯一日志 API；`DiagnosticsToast` 是“气泡加日志”的独立 facade，详细格式和 sink 见 [开发期诊断表层](25-开发期诊断表层.md)。`diagnostics` 只提供 reload、fake error 和 Toast 显示开关。

# 上下文能力

通过 provide/inject 和明确的 InjectionKey 交付业务上下文。主题与行为服务的边界见 [主题与扩展包](20-主题与扩展包.md)。

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



