# SFA 与模板写法

本文是 Arrange SFA 文件格式与模板语法的唯一事实源。宿主边界与运行时对象模型分别见 [Arrange 宿主目标](27-Arrange宿主目标.md) 和 [运行时](04-运行时.md)；其他文档只引用本文，不重复定义模板规则。

## 文件与初始化

SFA（Single-File Arrangable）使用 `.sfa` 扩展名。推荐先写 `<template>`，再写 `<script>`。`<script>` 不需要额外的 `setup` 或语言属性；它以 TypeScript 为基础，作为 SFA 的 setup 脚本参与编译与转换。没有初始化逻辑时可以省略 script。

SFA 的顶层区块只有 template 与 script，每类至多一个。视觉表现通过 Arrangable 参数和 Modifier 表达。

setup 按实例执行一次，该 Arrangable 不退场的重排**不会重新执行其初始化**。SFA 顶层初始化系同步（有没有必要做异步支持）；共享逻辑可放进独立 `.ts` 模块。`defineProps`、`withDefaults`、响应式状态、生命周期及 provide/inject 按正式 API 使用。

## SFA 与纯 TypeScript 的编译边界

`.sfa` 的模板和脚本都经过 Arrange 编译与转换。单位后缀、Color 构造和正式消费位置的单位处理在两者中都可用；`<script>` 不是原样执行的独立 `.ts` 文件。转换后再由 TypeScript 工具链处理生成代码。

| 源码位置 | 单位与颜色特色写法 | Ref 读取 |
| --- | --- | --- |
| `.sfa` 的模板绑定表达式 | 支持 `8.dp`、`16.sp`、`8.px`、`Color(...)` 和 `Color.hsl(...)` | setup 绑定按模板规则自动解包，尖括号作用域可取消解包 |
| `.sfa` 的 `<script>` | 支持相同的单位与颜色转换，以及脚本宏 | 保留脚本读取规则，显式使用 `.value` |
| 独立 `.ts` 模块 | 使用原始 TypeScript 和真实 API 签名，没有 SFA 转换 | 显式使用 `.value` |

模板中的自动解包不扩展到脚本或被导入的 `.ts` 函数内部；独立 `.ts` 也不会因为被 SFA 导入而获得特色语法。以下 SFA 在脚本中声明单位与颜色，并在模板中消费：

```sfa
<template>
    <Box :modifier="M.width(width).background(tone)">
        <Text :text="label" :modifier="M.clickable(rename)"/>
    </Box>
</template>

<script>
import { ref } from '@arrange/framework'
import { Color, M } from '@arrange/framework/ui'

const width = 8.dp
const tone = Color(0xff336699)
const label = ref('标题')
function rename() {
    label.value = '已更新'
}
</script>
```

在独立 `.ts` 中构造同样的 Modifier，使用真实参数契约：

```ts
import { M } from '@arrange/framework/ui'

const modifier = M.width(8, 0).background(0xff336699)
```

## 模板节点

模板中的 `<Xxx/>` 是模板节点，通常对应一个 Arrangable 调用。一般建议同级模板节点间空一行。模板节点可以有子节点（前提是对应 Arrangable 声明了默认 Slot），节点上可以通过 `a-bind`、冒号绑定、动态参数名、对象参数绑定和 `.camel` 传入参数，但调用必须符合目标 Arrangable 的 prop 声明与名称归一化规则（下述）。

参数名使用确定的 camelize 规则归一化；标签名必须准确 PascalCase，不做大小写、短横线或模糊猜测。每个 Arrangable 只接收自己声明的参数：无 attrs 收集，无 prop 透传，无隐式转交给子 Arrangable。子节点“把模板节点内容灌入其Arrangable的槽位”，绝非未声明参数的旁路。

模板只提供 Arrange 自己的能力，没有 HTML、DOM、CSS 或浏览器元素语义。参数词汇不自带特殊能力，包括 ref 在内的普通参数按目标声明处理；回调通过声明的普通函数 prop 传递。

模板内容位置不接受裸文本或插值。显示文字必须使用 `Text` 的 `text` 参数；标签之间的排版空白统一忽略。

## 推荐写法

以下是风格建议（建议你这么写，当然不这么写也不会导致编译不过）：

- 不建议把一个模板节点跨多行书写
- 不建议在节点结束的 `>` 或 `/>` 前留有/额外加空格。需搞为`<Xxx/>`、`<Xxx :aaa="a"/>`
- 独占行注释建议缩进对齐同级模板节点

## 特色：原样 Ref 表达式（即“取消自动解包”）

模板 JavaScript 表达式中，用尖括号包裹的表达式内部的`为 Ref 的表达式结果`将取消自动解包：

```axml
<Editor :state="selected ? <secondRef> : <firstRef>"/>
```

当然，外层包裹写法也等价：

```axml
<Editor :state="<selected.value ? secondRef : firstRef>"/> // 注意：`<>`内已取消自动解包，故须写`selected.value`
```

尖括号只深度影响其作用域内的结果。作用域外仍按普通模板表达式处理；接收方声明 `Ref<T>` 或只读 Ref 后，实际读取 `.value` 由接收方明确完成。原样传递不会把 Ref 的写权限扩大，也不会因为只传本体而订阅其 value。

注意：自动解包以及用尖括号包裹取消解包，都是对应你在本地 Setup 声明的 Ref。目前暂不支持传入 Props 中的 Ref 在模板 JS 表达式中的自动解包与取消自动解包。

## 特色：伟大 XML 单行注释支持

Arrange 模板支持标签外的 `//` 单行注释，独占一行和节点行末是同一种写法：

```axml
// 这是独占行注释
<Text text="标题"/> // 这是行末注释
```

注释只存在于源码，不进入编译产物，当然也不产生模板节点、作用域、实例或布局。属性、绑定表达式和字符串中的 `//` 仍按原语义处理。不提供 `/* */` 多行注释。

## 单位值编译

SFA 模板与脚本的单位位置要求明确值壳或已声明单位的值；纯 `.ts` 按真实参数契约传数字。单位及 Density 含义以 [基础类型](10-基础类型.md) 为准。

编译器根据导入、转导出及声明身份识别构造与消费，处理局部遮蔽，不按 dp/sp 等拼写替换。分析跨 SFA 定义时保留单位声明；最终输出才拆壳，源码映射及依赖列表仍指向真实文件。条件、变量、函数参数与 prop 的已知不匹配在最早边界拒绝；无法确定的动态输入须明确声明契约。

消融将长度表达式生成平铺的 `(dp, px)` 双通道数字，SP、PX-only 与颜色消费位置生成单个数字，不提前执行用户函数或读取 Density。表达式求值时机、依赖和副作用仍按源码保留。

`Color(number)`、通道对象和 `Color.hsl(...)` 展开为 ARGB 数字或数字计算表达式，不注入运行时颜色 helper，也不保留颜色值对象。静态构造在编译期校验，动态构造保留等价校验。直接字面量的静态通道可以常量折叠；对象引用在调用时读取字段，`const` 不代表对象字段不可变。通道表达式按源码顺序各求值一次，不能删掉 `void` 表达式的求值或把被遮蔽函数当作编译期构造。

生成代码和手写 `.ts` 均按真实 API 传数值。SFA 转译、完整 TS 类型检查和 bundle 是不同环节，能打包不表示脚本类型检查已通过。
