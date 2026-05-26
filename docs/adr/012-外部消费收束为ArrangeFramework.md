# ADR 012：外部消费收束为 Arrange Framework

日期：2026-05-26

## 背景

Arrange 当前定位是 JUCE 的声明式原生 UI framework。QuickJS-NG 是 Arrange 的运行基础，JUCE 是 Arrange 当前唯一面向的平台。

内部可以按职责拆分 runtime、toolchain、core、quickjs、juce 等模块；外部用户不应为这些内部边界配置多个包、多个 target 或多组开关。

## 决策

Arrange 外部消费收束为单一 framework：

```txt
npm:    @arrange/framework
native: Arrange::framework
CLI:    arrange
```

`@arrange/framework` 是用户侧唯一 npm 包，包含 authoring API、Arrange Vue、开发与构建工具链。

`Arrange::framework` 是用户侧唯一 native target，包含 core、QuickJS-NG 接入与 JUCE 接入。

QuickJS-NG 与 JUCE 不作为外部 feature toggle。用户可以覆盖源码来源，但不需要选择“是否启用”它们。

Demo 从根 CMake 解绑，作为用户样板独立消费 `@arrange/framework` 与 `Arrange::framework`。

## 影响

- `@arrange/runtime`、`@arrange/vite-plugin` 与 `@arrange/vue-*` 只作为内部包边界。
- `Arrange::core`、`Arrange::quickjs`、`Arrange::juce` 只作为内部 native 模块边界。
- 文档、demo、发布脚本与验证脚本都应以单包、单 target 的外部消费模型为准。
