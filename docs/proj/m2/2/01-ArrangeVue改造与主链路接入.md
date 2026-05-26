# Arrange Vue 改造与主链路接入

本任务负责把 Arrange 从外部官方 Vue 依赖，切换到内部维护的 Arrange Vue 主链路。

这不是包名替换，也不是在外部 Vue custom renderer 外面加补丁。Arrange Vue 必须成为面向 Arrange host target 的 authoring、composition、scheduler 与 lowering 前端。

# 目标

建立内部 Arrange Vue 包族或等价源码组织，使用户继续使用 Vue-like authoring 体验，但生产语义由 Arrange 控制：

```txt
SFC / template / script setup
-> Arrange Vue compiler / runtime / reactivity / scheduler
-> Arrange host target lowering
-> MutationTransaction / SlotUpdateBatch
-> FramePlan
-> SceneFramePipeline
```

# 任务

## 1. 建立 Arrange Vue 源码边界

必须建立明确的内部 Vue 改造边界，可采用包族或等价源码组织：

- `@arrange/vue-reactivity`
- `@arrange/vue-runtime-core`
- `@arrange/vue-compiler-core`
- `@arrange/vue-compiler-sfc`
- `@arrange/vue-shared`

要求：

- 以当前锁定的 Vue 3.5.34 fork / specialization 为基础。
- 保留 SFC、template、`<script setup>`、props、emits、slots、lifecycle、provide / inject 等 authoring 能力。
- 删除或隔离 DOM host 假设。
- 不把 DOM renderer、browser global、CSS style patch 当成 Arrange 生产路径。
- 上游同步策略必须清楚，不能把改造散落成不可维护补丁。

## 2. `@arrange/framework` 成为用户唯一主入口

`@arrange/framework` 必须 re-export Arrange Vue authoring API：

- `ref`
- `reactive`
- `computed`
- `watch`
- `watchEffect`
- `onMounted`
- `onUnmounted`
- `nextTick`
- 必要 lifecycle 与 effect scope 能力

要求：

- 用户写 Arrange App 时不需要从外部 `vue` 包导入核心响应式 API。
- demo、测试、文档中的用户示例必须改为从 `@arrange/framework` 导入。
- 外部标准 Vue 不能继续作为 Arrange UI 主链路事实源。

## 3. Arrange host target compiler lowering

compiler 必须识别 Arrange host vocabulary：

- `Box`
- `Row`
- `Column`
- `Spacer`
- `Text`
- `Input`
- `Image`
- `Icon`
- `Canvas`
- `FlowRow`
- `FlowColumn`
- `LazyColumn`
- `LazyRow`
- `LazyVerticalGrid`
- `LazyHorizontalGrid`
- 用户 Vue component，且最终展开为 Arrange host component tree

lowering 必须产生 typed host op，而不是泛用 DOM prop patch。

必须覆盖：

- host component 类型。
- typed prop。
- `modifier`。
- event slot。
- resource slot。
- reactive slot binding。
- text child 与 `Text.text` 关系。
- `v-if` 结构 mutation。
- `v-for` key 与结构 mutation。
- `v-model` 到受控 prop + event slot。
- dynamic component 最终展开到 Arrange host tree。

不允许：

- DOM tag 混入生产 host tree。
- `class` / `style` / SFC `<style>` 成为生产样式入口。
- 任意 `on*` 字符串猜测事件语义。
- unknown prop 静默进入 native。
- 把无法 lowering 的节点先塞进通用 object bucket。

## 4. Vite 插件接入 Arrange Vue compiler

`Arrange 工具链` 必须使用 Arrange Vue compiler 作为 SFC 编译入口。

要求：

- SFC、template、`<script setup>` 进入 Arrange host target lowering。
- dev server、HMR、diagnostics 与 compiler diagnostics 接入同一事件系统。
- build 输出仍符合 Arrange UI package 约定。
- 不保留外部 Vue compiler 作为生产 fallback。

## 5. runtime host operations 接入 native transaction

Arrange Vue runtime 的 host op 必须收敛到 QuickJS native transaction API：

```txt
create node
delete node
insert child
remove child
set text
set typed prop
set modifier
update / retire event slot
explicit native invalidation
```

要求：

- QuickJS host 直接读取 JSValue、primitive 与 callback function。
- 不生成 JSON。
- 不 stringify。
- 不生成 binary command buffer。
- 不生成 BridgeOp / BridgeBatch。
- 不保留 generic serializer 作为 fallback。
- `endTransaction()` 只提交意图，不能在调用栈内 apply tree、layout、draw 或 repaint。

## 6. HMR / reload / error recovery 生命周期接入

必须统一处理：

- initial mount。
- HMR reload。
- manual reload。
- source switch。
- error recovery。
- unmount。
- QuickJS context reset。

要求：

- 旧 App 的 callback、event slot、slot binding、pending transaction、pending slot update 必须全部退休或清空。
- HMR 后不得触发旧 callback。
- 错误恢复后不得残留旧树、旧 slot、旧 diagnostics 状态。
- reload 只能进入统一 load / runtime / FramePlan 链路，不得旁路 patch UI。

# 完成标准

- demo UI 通过 Arrange Vue compiler / runtime 主链路运行。
- `@arrange/framework` 是用户 import 的主入口。
- 外部标准 Vue 不再作为生产 authoring runtime 事实源。
- SFC、template、`<script setup>`、`v-if`、`v-for`、`v-model`、用户组件可用。
- host component lowering 产出 typed mutation 与 typed slot binding。
- HMR、reload、错误恢复不泄漏旧 callback 或 slot binding。
- 测试能证明 compiler / Vite / runtime / QuickJS / native transaction 是同一条链路。

# 禁止完成判定

出现以下情况，不得标记本任务完成：

- 仍依赖外部标准 Vue runtime 作为 Arrange UI 主路径。
- compiler 只是把 template 编成旧 renderer 能看懂的普通 prop。
- 生产路径仍有 JSON / string / binary bridge。
- unknown prop 被静默透传。
- event callback 不是通过真实 JS function 注册。
- HMR 只是重跑脚本，没有完整退休旧 binding。
- 代码靠“兼容旧测试”保留旧 production semantics。
