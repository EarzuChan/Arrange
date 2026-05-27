# Native包消费与FetchContent契约

本文定义 Arrange 原生侧对外消费的长期边界。它只约束 C++ / JUCE 用户如何获取、链接和验证 Arrange 原生包，不替代 [工具链与App发布包](14-工具链与App发布包.md)、[内部包构建与分发契约](29-内部包构建与分发契约.md) 或 [Demo](23-Demo.md)。

标准 Arrange 工程中，FetchContent 接入通常由 Arrange CLI 创建或维护；本文仍是原生消费边界的事实源。

# 目标

Arrange 原生侧提供：

```txt
FetchContent source package
-> Arrange::framework
-> 用户插件 / 应用
```

当前不提供 vcpkg、Conan、微软中央仓库二进制包，也不把 system install 作为首要发行形态。

# 消费边界

- 用户通过 CMake `FetchContent` 拉取 Arrange 源码包。
- 用户只链接公开 target `Arrange::framework`。
- 用户工程不应依赖仓库内部路径、临时 demo 特供路径或旧 `_deps` 缓存。
- 原生消费面必须可在干净检出和显式源码覆盖条件下复现。

# 公开 target

原生包对外稳定暴露命名空间 target：

```txt
Arrange::framework
```

`Arrange::framework` 包含 Arrange 当前可用所需的 native 能力：core、QuickJS-NG 接入与 JUCE 接入。

`Arrange::core`、`Arrange::quickjs`、`Arrange::juce` 只作为内部模块边界，不作为用户文档入口。

# 依赖策略

- QuickJS-NG 是 Arrange 不可分割的运行基础。
- JUCE 是 Arrange 当前唯一面向的平台。
- QuickJS-NG 与 JUCE 不作为外部 feature toggle。
- 用户可以通过显式源码目录覆盖依赖来源。
- 不要求用户先安装到系统包管理器。
- 不把 demo 构建当作原生消费前提。

# 版本与一致性

- 原生版本号与 TS 包版本应保持可对齐关系。
- 原生协议版本与运行时握手版本必须可检查。
- 版本不匹配时必须走诊断路径，而不是默默兼容。

# 未来方向

后续或会继续完善：

- install/export。
- xmake helper。
- 归档布局。

这些能力必须先设计、写文档、再实现。
