# ADR 009：Arrange Vue、阶段化响应式与 Reactive Slot Runtime

日期：2026-05-17

## 背景

M1 打通了从 SFC authoring 到 QuickJS、native transaction、LayoutTree、DrawOps 与 JUCE paint 的完整闭环。这个闭环证明 Arrange 可以在 JUCE 宿主中运行声明式 UI，但后 M1 复盘发现，普通 custom renderer 链路会把许多 UI 值变化导向同一条通路：

```txt
ref changed
-> component render effect
-> VNode create / diff
-> generic prop patch
-> native mutation
-> dirty 推断
-> layout / draw
```

动画、颜色、尺寸、透明度、资源状态与事件槽替换在 UI 阶段中的影响不同。若它们都先点燃 composition 和 generic diff，再由 native 侧补做 dirty 归因，链路会产生无谓工作，并削弱 Arrange 对 layout、draw、event、resource 等阶段的精确控制。

## 决策

Arrange 的长期 JS 层定义为 **Arrange Vue**：面向 Arrange host target 的 authoring、composition 与 scheduling 前端。它保留 SFC、template、`<script setup>`、`ref` / `computed` / `watch`、组件组织与 Vite HMR 等高价值资产，但 compiler、runtime、scheduler 与 reactivity 必须服务 Arrange 的阶段化 UI runtime。

长期模型：

```txt
Arrange = Vue-like authoring experience
        + Compose-like phase-aware UI runtime
        + JUCE-native execution layer
```

核心原则：

```txt
Ref 本身不是问题。
问题是把所有 Ref 变化都统一解释为 Composition 变化。
```

Arrange Vue 必须建立 phase-aware reactivity：状态变化依据读取、绑定和消费位置进入不同失效域。

```txt
业务 / 结构状态      -> Composition dirty
尺寸 / 约束 / 度量    -> Layout dirty
颜色 / alpha / tint  -> Draw / Paint dirty
事件回调             -> Event slot update
资源状态             -> Resource / Draw dirty
```

为此引入 **Reactive Slot Runtime** 作为长期运行时方向：

```txt
Ref / computed / animatedXAsRef
-> typed UI slot binding
-> JS value phase flush
-> dirty slot batch
-> native FramePlan
-> LayoutTree / PaintModel / JUCE repaint
```

高频 UI 值变化不得默认触发 component render、VNode diff 或 generic prop patch。动画值、transition 状态和 easing / spring 计算可以由 JS value phase 承担；native render phase 负责消费 typed slot update，执行 scene apply、dirty resolution、measure、layout、draw preparation 与 publish。

FramePlan 的长期阶段模型升级为：

```txt
Composition Phase
JS Value Phase
Native Render Phase
```

## 影响

- `docs/arch/` 中的母文档必须确立“Arrange Vue + Reactive Slot Runtime + Unified FramePlan”为长期主线。
- `MutationTransaction` 不再是 JS 到 native 的唯一 UI 更新形态；长期还必须有 typed slot update / slot binding / dirty role。
- 动画 API 以 `animatedXAsRef` 一类 Ref authoring 心智为长期方向；关键语义是阶段化 slot dirty，而不是普通 Ref tick 触发 render。
- `@arrange/runtime` 应成为用户导入 `ref`、`computed`、`watch`、lifecycle 与 Arrange UI API 的主入口，避免用户代码绑定到不可改造的外部 runtime 入口。
- 后续里程碑需插入新的 M2：Arrange Vue 与 Reactive Slot Runtime。原高级 UI、Canvas、Interop 等里程碑顺延。

## 不做

- 不把 UI 高频值变化继续默认交给 component render / VNode diff / generic patchProp。
- 不把 `paint()`、controller、diagnostics、resource 或 host chrome 变成输出阶段入口。
- 不把 native 持有和计算所有 UI 值作为唯一正确路线；关键是阶段化失效与 typed slot 链路。
- 不让多个文档重复定义 Arrange Vue、Reactive Slot Runtime 或 FramePlan 阶段模型；长期事实源沉淀到 `docs/arch/`。

