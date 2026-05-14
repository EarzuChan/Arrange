# 目标

Arrange 借用 Vue 的 authoring、SFC、响应式和组件组织能力，但不采用 DOM / CSS 渲染模型。Vue 能力能否使用，取决于它是否能落到 Arrange host node、Modifier、native transaction 与 LayoutTree 这条链路。

判断标准：

- 只依赖 Vue 编译、响应式、组件生命周期和虚拟节点 diff 的能力，且和Compose的精神不冲突（甚至有共性），原则上应支持甚至大力支持。
- 依赖 DOM 元素、CSS、浏览器地址栏、`window` / `document` 的能力，且/或和Compose的精神不冲突，坚决不作为 Arrange 核心能力支持。
- 能表达为 Arrange 组件、Modifier、资源、event slot、native transaction 的能力，才可进入长期支持范围。

本标准50年不变（笑）。

# 明确支持

以下能力应作为 Arrange authoring 的基础能力：

- SFC。
- `<script setup>`。
- props / emits。
- slots / scoped slots。
- `ref` / `reactive` / `computed`。
- `watch` / `watchEffect`。
- lifecycle hooks，例如 `onMounted`、`onUnmounted`。
- provide / inject。
- `v-if`。
- `v-for`。
- `v-model`。
- dynamic component。
- Pinia。

# `v-if`

`v-if` 通过 Vue mount / unmount 表达结构变化。它应进入 Arrange renderer 的 create / insert / remove / delete mutation，并由 LayoutTree 统一处理结构 dirty。

要求：

- 删除分支必须退休对应 event slot。
- 重新出现分支必须重新建立 native node 与 Modifier / prop state。
- 不能保留不可见但仍参与 hit-test 的幽灵节点。

# `v-for`

`v-for` 可用于小规模、普通列表。它依赖 Vue keyed diff，并进入 Arrange 的结构 mutation。

要求：

- 用户应为可重排列表提供稳定 key。
- 大型集合不应使用普通 `v-for` 全量创建节点，应使用 Lazy 组件。
- Lazy 不是 `v-for` 语法糖；Lazy 拥有可视范围物化、测量缓存和滚动状态。

# `v-model`

`v-model` 是组件 prop + event 的便捷写法。对 `Input` 等受控组件，应落到明确 prop schema 与 event slot：

```txt
modelValue
onUpdate:modelValue / onUpdate:model-value
```

`v-model` 不允许退化为任意 prop / 任意 event 名称猜测。native 事件回调必须来自真实 JS callback。

# Dynamic component

`<component :is="...">` 应支持，但目标必须是：

- Arrange 内建组件。
- 用户 Vue 组件，且最终渲染 Arrange 组件。

不支持把 dynamic component 解析为 DOM tag，例如 `div`、`button`、`a`、`canvas`。

# KeepAlive

`KeepAlive` 属于目标支持能力。它可以保留 Vue 组件实例状态，但 native tree 的激活、停用、event slot、资源引用必须有明确行为。

要求：

- deactivated 子树不能继续参与 hit-test、focus、输入事件或绘制。
- activated 子树必须重新同步必要 native state。
- event slot 不能泄漏到已停用子树。

# Suspense

`Suspense` 属于目标支持能力。`default` 与 `fallback` 内容都必须渲染 Arrange 组件。

要求：

- fallback / resolved 切换进入结构 mutation。
- 异步错误必须进入 Vue error handling 与 Arrange diagnostics。
- 不允许依赖 DOM placeholder 或浏览器布局语义。

# Pinia

Pinia 主要依赖 Vue 响应式系统，不依赖 DOM，应支持。

要求：

- Pinia state 变化通过 Vue flush 进入 Arrange renderer。
- 不允许 Pinia plugin 直接访问 DOM / window / document 作为 Arrange 核心路径。
- 音频线程数据仍必须经互操作通道进入 UI，不允许 Pinia 直接接触音频线程。

# Vue Router

Vue Router 支持范围限定为 navigation / memory routing。

支持方向：

- `createMemoryHistory()`。
- `RouterView`。
- `router.push()` / `router.replace()`。
- route state 驱动 Arrange 组件树切换。

不支持方向：

- browser history。
- hash history。
- 地址栏语义。
- DOM `<a>` 默认行为。
- 依赖 CSS class 的 active link 样式。

`RouterLink` 若使用，必须走 custom slot 或 Arrange 封装，把导航动作接到 `m.clickable`，而不是渲染原生 `<a>`。

# 明确不支持

## DOM 标签

`div`、`span`、`button`、`input`、`canvas`、`a` 等 DOM 标签（这在我们被处理为未知标签）不属于 Arrange host node。作为任何未知标签，开发期应诊断报错+警告。

用户应使用：

- `Box` / `Row` / `Column` / `Spacer`。
- `Text` / `Input` / `Image` / `Icon` / `Canvas`。
- 用户自定义 Vue 组件，但其最终必须渲染 Arrange 组件。

## `class` / `style` / SFC `<style>`

Arrange 不使用 DOM / CSS 布局与样式系统。`class`、`style`、SFC `<style>` 不作为生产样式入口。

注：为了避让Vue对节点Style字段的特殊处理，我们文本节点的“Compose那般样式”的字段已设为了“text-style”。

用户应使用：

- Modifier。
- props。
- Arrange Local。
- 自己封装的组件与主题。

## `v-show`

`v-show` 在 Vue DOM renderer 中依赖 `style.display`。Arrange 没有 CSS display 语义，因此不支持 `v-show` 的 DOM 行为。

用户应知会：

- `v-if` 表达结构增删。
- 未来若需要保留布局位置或仅隐藏绘制，应设计 Arrange 自己的 visibility / alpha / semantics 规则，而不是复用 `v-show`。

## DOM `@click`

通用 DOM `@click` 不是 Arrange 主交互模型。点击语义必须通过 Modifier：

```ts
m.clickable(onClick)
```

原因：Arrange 的点击区域受 Modifier 顺序、padding、clip、transform、zIndex、enabled、focusable 等语义影响，不能用 DOM click 模型替代。

## Teleport

Vue Teleport 依赖 DOM target。Arrange 不支持 DOM Teleport。

如果未来需要 popup、overlay、portal，我们将再设计 Arrange Portal / Popup 系统，并明确它和 LayoutTree、focus、hit-test、zIndex、diagnostics scene 的关系。目前还未设定和提供官方内建 Tp-like 支持。

## Transition

Vue Transition 的常见语义依赖 CSS class 与 DOM patch timing。Arrange 不支持 Vue DOM Transition 作为核心动画路径。

用户应使用 Arrange animation API，例如 `animate*AsState`。

# 副作用写法

普通副作用使用 Vue Composition API：

- `onMounted` 启动订阅、timer、requestAnimationFrame 或资源请求。
- `onUnmounted` 取消订阅、cancel animation frame、释放资源。
- `watch` / `watchEffect` 处理响应式状态变化。
- `watch(..., onCleanup)` 处理 keyed effect 清理。
- `effectScope` 管理组合式封装的作用域。

Arrange 暂不考虑直接再复刻 Compose 的 `LaunchedEffect` / `DisposableEffect` API，用户应使用我们上文指出的方案。帧相关逻辑应使用 Arrange native frame clock 暴露的 `requestAnimationFrame` 或更高层动画 API，不能用 Promise / microtask 假装逐帧刷新。

# 不做

- 坚决不可能兼容 Vue DOM renderer 的行为，我们内部的Renderer是特色Renderer，有明确约束。
- 坚决不会让 DOM、CSS 思想影响 Arrange 布局、绘制或交互：这是错误路线，“修正主义”，绝不被容忍。
- 不把 Router browser history、Teleport、Transition 伪装成可用能力，不支持就是不支持，无回旋余地。