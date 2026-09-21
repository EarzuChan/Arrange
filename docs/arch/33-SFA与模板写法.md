# SFA 与模板写法

本文是 Arrange SFA 文件格式与模板语法的唯一事实源。宿主边界与运行时对象模型分别见 [Arrange Vue 宿主目标](27-ArrangeVue宿主目标.md) 和 [运行时](04-运行时.md)；其他文档只引用本文，不重复定义模板规则。

## 文件与初始化

SFA（Single-File Arrangable）使用 `.sfa` 扩展名。推荐先写 `<template>`，再写 `<script>`。`<script>` 不需要额外的 `setup` 或语言属性；它默认且只能是 TypeScript setup。没有初始化逻辑时可以省略 script。

一个 SFA 不能写第二个 script、Options API、JSX/TSX 或 style 块。style 能力已经退出；视觉表现通过 Arrangable 参数和 Modifier 表达。

setup 按实例执行一次，重排不会重新执行初始化。SFA 顶层初始化必须同步；共享逻辑放进独立 `.ts` 模块。`defineProps`、`withDefaults`、响应式状态、生命周期及 provide/inject 按正式 API 使用。

## 模板节点

模板中的 `<Xxx/>` 是模板节点，通常对应一个 Arrangable 调用。一般建议同级模板节点间空一行。它可以有子节点（前提是对应 Arrangable 声明了默认 Slot），也可以通过 `v-bind`、冒号绑定、动态参数名、对象参数绑定和 `.camel` 传入参数，但调用必须符合目标 Arrangable 的 prop 声明与名称归一化规则。

参数名使用确定的 camelize 规则归一化；标签名必须准确 PascalCase，不做大小写、短横线或模糊猜测。每个 Arrangable 只接收自己声明的参数：没有 attrs 收集，没有 prop 透传，没有隐式转交给子 Arrangable。子节点是内容入口，不是未声明参数的旁路。

模板只提供 Arrange 自己的能力，没有 HTML、DOM、CSS 或浏览器元素语义。`v-model`、`v-pre`、`v-once`、`v-memo`、`:ref`（Vue中的 Dom 对象引用取得）、`v-on`（`@`）、emits/emit 等均没有解释或执行入口。回调通过声明的普通函数 prop 传递。

模板内容位置不接受裸文本或插值。显示文字必须使用 `Text` 的 `text` 参数；标签之间的排版空白统一忽略。

## 推荐写法

以下是风格建议（建议你这么写，当然不这么写也不会导致编译不过）：

- 不建议把一个模板节点跨多行书写
- 不建议在节点结束的 `>` 或 `/>` 前额外放空格
- 独占行注释建议缩进对齐同级模板节点

## 原样 Ref 表达式（即“取消自动解包”）

模板 JavaScript 表达式中，尖括号包裹内的`为 Ref 的表达式结果`取消自动解包：

```axml
<Editor :state="selected ? <secondRef> : <firstRef>"/>
```

当然，外层包裹写法也等价：

```axml
<Editor :state="<selected.value ? secondRef : firstRef>"/> // 注意：`<>`内已取消自动解包，故须写`selected.value`
```

尖括号只深度影响其作用域内的结果。作用域外仍按普通模板表达式处理；接收方声明 `Ref<T>` 或只读 Ref 后，实际读取 `.value` 由接收方明确完成。原样传递不会把 Ref 的写权限扩大，也不会因为只传本体而订阅其 value。

注意：自动解包以及用尖括号包裹取消解包，都是对应你在本地 Setup 声明的 Ref。目前暂不支持传入 Props 中的 Ref 在模板 JS 表达式中的自动解包与取消自动解包。

## Arrange 特有的伟大 XML 单行注释支持

Arrange 模板支持标签外的 `//` 单行注释，独占一行和节点行末是同一种写法：

```axml
// 这是独占行注释
<Text text="标题"/> // 这是行末注释
```

注释只存在于源码，不进入编译产物，不产生模板节点、作用域、实例或布局。属性、绑定表达式和字符串中的 `//` 仍按原语义处理。不提供 `/* */` 多行注释。
