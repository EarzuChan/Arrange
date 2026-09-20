# Arrange Vue 宿主目标

Arrange Vue 是 Arrange 的模板编译与响应式执行前端，服务于原生 LayoutNode、Modifier、typed mutation 和帧发布。Arrangable 是唯一的可组合视图定义；定义、调用实例、Layout 所属 RearrangeNode 和原生布局实体具有不同身份，完整模型见 [运行时](04-运行时.md)。

## SFA 与初始化

用户视图通过 SFA（Single-File Arrangable）模板创建，扩展名为 .sfa。文件最多一个无属性的 script 块，统一按 TS setup 处理；没有逻辑时可省略。template 在前、script 在后，同级模板节点之间留空行。

script 顶层绑定可供模板读取，初始化按实例执行一次，重排不重新初始化。import 保留模块语义；共享状态、导出和工具函数放到独立 .ts 模块。script setup、lang、双脚本、Options API、JSX/TSX 和 .vue 双扩展名加载均不属于正式契约。

初始化为同步过程，SFA 顶层 await/for-await 在编译期拒绝，运行时拒绝返回 Promise 的初始化。异步业务函数可正常使用，加载状态、成功结果与错误通过明确状态和模板控制流表达；没有隐式等待分支或跨 await 恢复初始化上下文的协议。

defineProps 与 withDefaults 声明业务参数。响应式状态、观察、生命周期及 provide/inject 在 setup 中使用。公开 API 与内建参数签名见 [基础 API 形态](21-基础API形态.md)。直接代码编写与 SFA 编译使用同一 Arrangable 契约，普通 FA 没有原生特权；用户仍通过 SFA 组织视图，可直接调用 Layout 并组合与 FA 相同的 UI 描述，不需要 Foundation 专用入口。公共包分层及内部 helper 的收口仍须按包边界完成，不能把内部可调用等同于公开承诺。

## 封闭模板语言

模板只接受准确 PascalCase 定义名称、v-if/v-else-if/v-else、v-for、显式 Rearrange key、参数绑定和内容入口。标签不进行 kebab-case、大小写或模糊名称猜测。

内容位置不接受裸文本或插值。标签之间的排版空白统一忽略，显示文字只能通过 Text 的 text 参数。对象不会被转换成显示字符串。内部结构锚点没有文字呈现能力。

保留的参数语法如下：

| 写法 | 语义 |
| --- | --- |
| title="正文" | 固定字符串，不解析为 JS |
| enabled | 固定布尔 true |
| :amount="expression" 或 v-bind:amount="expression" | TS 表达式的反应式求值 |
| :[name]="expression" 或 v-bind:[name]="expression" | 动态参数名与表达式 |
| v-bind="parameters" | 按声明逐项处理对象字段 |
| .camel | 仅转换参数名称 |

冒号绑定必须给出表达式，不存在同名补全。参数声明名与传入名使用确定的 camelize 规则，槽位名称和标签不参与此转换。静态重复在编译期报告；动态名字与对象字段在组装边界拒绝归一后的重复，不覆盖、不合并函数、不按顺序选择胜者。

模板 ref、@/v-on、v-model、emits/emit、defineModel、defineOptions、defineExpose、v-html、v-show、v-pre、v-once、v-memo 及用户指令扩展不具有解释或执行入口。回调通过明确声明的普通函数 prop 传递，原生 typed event slot 仍负责真实输入事件的注册、代际与退休。

## 参数边界

每个 Arrangable 只接收自己声明的参数；modifier 同样必须声明。未声明参数报错，不收集 attrs，不透传，不因零根、单根或多根而改变行为。实现必须显式读取和转交参数，Modifier 多次交付产生独立受体实例。

类型错误拒绝调用或更新，不转换字符串/布尔值，不警告后继续执行。没有显式默认值就保持未传，required 则报告缺失。默认工厂按实例求值，优化不能提前执行它。modelValue、style 等词可以由业务声明为普通参数，但没有系统特权。

编译器对固定定义和固定名称生成位置表；定义连接阶段按正式声明核对名称、默认值及校验入口，后续消费使用确定位置。连接在调用点首次运行时完成，不提前执行默认工厂。单个表达式分别缓存，完整新参数组先校验再交付实例，校验器不接收Rearrange key。动态定义及对象字段遵守同一实际调用边界。安全参数描述与内容入口可以缓存，列表条目、槽位词法变量和Rearrange key 不得被缓存冻结。

## Ref 本体

普通绑定自动解包 Ref。完整表达式外层的尖括号标记表示原样传递，例如 :state="<documentRef>"。编译器先辨认完整 TS 表达式，类型断言和泛型语法不能被简单字符串替换误拆；标记内部仍按 TS 求值。显式 .value、函数及代理已经产生的解包结果不会被重建。

接收方声明 Ref<T> 或只读 Ref 契约。参数保持原 Ref 身份，只读状态不因传递获得写权限；不能重新给 prop 赋值。原样表达式仍反应式求值，选择另一个 Ref 时切换身份；仅传本体不会订阅它的 value，实际消费 .value 的结构或值作用域自行订阅。运行时验证可识别的 Ref 契约，不假装验证任意泛型业务内容。

## 内容声明与调用

Slot 是模板语法，不是运行时 Arrangable 或布局盒子。实现中的 Slot 声明并调用默认内容；Slot name="header" 声明并调用具名内容。name 必须静态，不接受业务 prop、Modifier、出口参数或默认子内容。未提供已声明内容时为空，未声明内容则拒绝。

提供方使用 Template #header 或 Template v-slot:header；默认内容可直接书写，或显式选择 default。Template 仅分组，不增加实例、RearrangeNode 或 LayoutNode。内容为无参数函数，不能使用 scoped slot 解构。

每次内容调用建立独立结构作用域，词法输入来自提供方，生命周期属于调用位置。同一内容可调用多次，各次拥有独立状态、订阅和实例；内容调用本身不产生 RearrangeNode，只有其中实际调用的 Layout 产生节点。内容依赖只唤醒实际消费者；词法条目更新刷新闭包，退出后取消任务及依赖，描述缓存不能冻结变量或窥探内容根数量。

## 控制流与生命周期

v-if 和 v-for 产生结构操作，显式 Rearrange key 决定复用和替换。Rearrange key 不进入业务 props，与 Modifier.keyed 和原生 handle 分开。分支退出退休绑定与事件资源；keyed 移动保留对应实例，删除后迟到任务不得写入退休目标。

KeepAlive 按 cacheKey 缓存整份零根、单根或多根内容；有限缓存逐出与所有者卸载停止整份作用域。停用撤销原生交互资格并暂停 UI 消费，恢复同步最新状态。缓存管理使用统一实例与内容作用域机制，后端资源仍由内容中的 Layout 管理；不持有复制的 VNode，也没有专属 FA 状态工厂。具体帧资格和生命周期通知归属 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

DynamicArrangable 的 is 明确选择定义，props 是该定义的参数对象；外层与目标分别校验，不能把外层未声明参数透传给目标。导航可用业务状态选择定义，不依赖浏览器地址栏。

异步工作必须具有作用域、请求身份与代际，迟到结果不能恢复已卸载内容。Suspense、Teleport 和 Vue Transition/TransitionGroup/BaseTransition 没有公共入口、专用结构字段或执行协议。动画采用 Arrange 自有 API，见 [动画与 Transition](28-动画与Transition.md)。统一帧调度与公共包分层存在后续施工边界时，以工作记录说明实际完成度，不把目标文档作为已实现证据。

## 工具链与诊断

真实 .sfa 文件经过统一编译、TS 转译、源码映射及 Vite 构建进入 QuickJS。命令行检查保留脚本与跨 SFA 的参数、内容契约，支持 TS paths 解析；不能以通配 any 声明代替检查。类型依赖进入 watch，并在更新时清理解析缓存；热更新通过宿主 reload 统一退休旧上下文。

模板值携带文件、行列与输入名称，求值、参数拒绝和原生 typed 提交保留错误来源。Painter 异步失败保留资源地址与消费位置，经正式发布边界展示。专用 IDE 插件不作为交付前提。

源码发布形态下，Vite 配置使用 `--configLoader runner` 解析 Framework 的 TS 工具入口；独立消费者需同时执行 `checkSfaProject` 和生产构建，不能仅以脚本转译结果作为类型验证。
