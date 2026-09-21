# 内建 Arrangable

本文定义 Foundation Arrangable（FA）的布局、呈现与资源职责；公开参数及类型归属见 [基础 API 形态](21-基础API形态.md)，模板调用规则见 [SFA 与模板写法](33-SFA与模板写法.md)。

## 定义与组合

Foundation Arrangable（FA）是 Framework 提供、直接用代码编写的 Arrangable。SFA 与代码定义使用同一参数、内容、初始化、调用和生命周期契约；Foundation 来源不授予任何特权。内建实现采用代码是组织方式，用户可以用 SFA 组合出相同行为。

普通 FA 显式处理 props、选择 MeasurePolicy、组合 Modifier 并调用 Layout 或其他 Arrangable。每个定义独立声明自己的参数，不建立 commonProps/CommonInputs，不收集隐藏参数、能力表或宿主输入。代码定义需要的基础行为构造能力遵守正式 UI 契约，不能为 Foundation 留一条用户 SFA 无法表达的旁路。

Layout 是其中唯一具有框架深层节点接入的正式 Arrangable；它可被所有 SFA 和代码定义使用。Layout 的唯一特权、RearrangeNode 生命周期和重排过程以 [运行时](04-运行时.md) 为唯一事实源。普通 FA 只组织调用，最终 Modifier 应用经过 Layout。

KeepAlive 和 DynamicArrangable 同样遵守普通定义与调用契约。KeepAlive 通过统一实例和内容作用域机制表达保留，不复制虚拟节点字段，不另设 Foundation 状态工厂或权限声明；内容契约见 [SFA 与模板写法](33-SFA与模板写法.md)。

## 布局策略

MeasurePolicy 是与 FA 解耦的布局算法值。策略输入经过类型校验，参数变化只使实际消费者失效，缓存不形成按名称选择策略的隐式协议。

| FA | 显式实现与内容 |
| --- | --- |
| Layout | 唯一最终 Modifier 受体，管理 RearrangeNode，接收 Policy 和默认内容 |
| Box | 调用 Layout，选择 BoxMeasurePolicy，接受默认内容 |
| Row | 调用 Layout，选择 RowMeasurePolicy，接受默认内容 |
| Column | 调用 Layout，选择 ColumnMeasurePolicy，接受默认内容 |
| Spacer | 调用 Layout，选择 MinSizeMeasurePolicy，不接受内容 |
| Text | 组合显示文本 Modifier，调用 Layout，使用 MinSizeMeasurePolicy 处理空内容，不接受内容 |
| Input | 组合文本编辑 Modifier，调用 Layout，使用 MinSizeMeasurePolicy 处理空内容，不接受内容 |
| Image | 调用 Layout，选择 MinSizeMeasurePolicy 并追加 paint Modifier，不接受内容 |
| Icon | 调用 Box，追加 paint Modifier，不接受内容 |

Box 叠放内容，默认对齐 TopStart；子项显式 M.align 优先于容器对齐。Row/Column 按主轴排列，消费 arrangement、交叉轴 alignment 与子项 weight。MinSizeMeasurePolicy 返回约束最小宽高，不为 Spacer/Image 创造专属测量分支。文本测量属于文本 Modifier 所在层，Layout 的空内容策略不读取文本字段、不重复排版；文本行为详见 [文本输入与绘制](18-文本输入与绘制.md)。

未来 JS MeasurePolicy 必须扩展同一 Layout 契约：在 Owner 受控测量阶段接收约束及子项测量能力，返回 typed MeasureResult。它不能异步等待、改写结构、派发任意事件或跨线程访问。当前只提供已实现的原生策略值，不公开空壳 JS 回调入口。

## 无装饰样式

FA 不自带背景、边框、圆角、阴影、装饰性 padding、主题色、设计系统字体或输入框皮肤，不通过 provide/inject 取得视觉样式。行为服务可以注入，但不得暗改样式。

未指定文字颜色时 Text/Input 使用基础黑色；字体和字号仅有基础排版 fallback。Input 的光标、选区、焦点与 IME 属于编辑行为。Icon 未指定 tint 时保留 Painter 原色，不补主题色或固定图标尺寸。

Input 使用 value 与显式 onValueChange 函数参数表达受控文本；Text 仅消费 text 参数。文字几何、输入事件与缓存规则归属 [文本输入与绘制](18-文本输入与绘制.md)。

## Painter

Painter 由资源获取层创建，提供固有尺寸、内容版本、状态、错误与释放能力。Image/Icon 只消费 Painter，不接收 source、path 或 URL 来加载资源。资源路径规则归属 [工具链与 App 发布包](14-工具链与App发布包.md)。

资源请求具有身份与代际，加载和解码在工作线程执行，Owner 接收不可变结果后更新 Painter 状态。paint Modifier 消费资源快照及版本，固有尺寸变化进入必要测量，内容变化进入绘制失效。绘制阶段不回调任意 JS。

Image 使用 contentScale、alignment 和 alpha；Icon 的显式 tint 转为 colorFilter。Fit、Crop、FillBounds、FillWidth、FillHeight、Inside、None 使用统一缩放与对齐语义，绘制限制在目标区域内。SVG 固有尺寸来自视口，保留 viewBox 中的透明留白，不使用可见图形边界冒充视口；未给绝对宽高时使用 viewBox 尺寸，无 viewBox 时使用 300 × 150 基础视口。显式 Modifier 尺寸与父约束共同决定布局，paint 可以使用 Painter 固有尺寸参与约束。

Painter 在创建作用域退出时释放，也可显式 dispose。释放后取消该请求的消费资格；迟到结果不能复活已退休资源或节点。已发布 DrawOp 共享持有不可变内容，释放 Painter 不使旧帧悬空。加载失败通过消费表达式的源码位置进入正式诊断与发布边界。

首版获取层处理 package 内资源，支持位图和 JUCE SVG 解码，不承诺任意网络加载、任意 SVG 特性或资源热刷新服务。资源完成的具体调度入口遵守 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

## 后续能力

Canvas、Flow、Lazy 与复杂图像滤镜尚未公开。Canvas 必须采用受控绘制描述与缓存；不能以任意 onDraw JS 回调穿透原生绘制阶段。Lazy 必须设计可视范围物化、稳定条目身份、滚动与回收能力；不沿用已经删除的带参 Slot 协议，也不把普通 v-for 冒充虚拟化。



