# Native包消费与FetchContent契约

本文定义 Arrange 原生侧对外消费的长期边界。它只约束 C++ / JUCE 用户如何获取、链接和验证 Arrange 原生包，不替代 [工具链与App发布包](14-工具链与App发布包.md)、[内部包构建与分发契约](29-内部包构建与分发契约.md) 或 [Demo](23-Demo.md)。

# 目标

Arrange 原生侧先提供：

```txt
FetchContent source package
-> Arrange C++ targets
-> 用户插件 / 应用
```

当前不提供 vcpkg、Conan、微软中央仓库二进制包，也暂未打算把 system install 作为首要发行形态。

# 消费边界

- 用户通过 CMake `FetchContent` 拉取 Arrange 源码包。
- 用户通过公开 target 链接 Arrange。
- 用户工程不应依赖仓库内部路径、临时 demo 特供路径或旧 `_deps` 缓存。
- 原生消费面必须可在干净检出和显式源码覆盖条件下复现。

# 公开 target

原生包应对外稳定暴露命名空间 target：

- `Arrange::core`
- `Arrange::quickjs`
- `Arrange::juce`

具体导出形态可以在后续安装/导出阶段完善，但目标名与消费语义应先固定。

# 依赖策略

- JUCE 与 QuickJS-NG 允许以源码方式进入构建树。
- 外部用户可通过显式源码目录覆盖或 FetchContent 获取依赖。
- 不要求用户先安装到系统包管理器。
- 不把 demo 构建当作原生消费前提。

# 版本与一致性

- 原生版本号与 TS 包版本应保持可对齐关系。
- 原生协议版本与运行时握手版本必须可检查。
- 版本不匹配时必须走诊断路径，而不是默默兼容。

# 未来方向

后续或会继续完善：

- install/export。
- CMake helper。
- xmake helper。
- 归档布局。

这些是可能是未来的方向，当前未实现、未提供，不要精神错乱。
