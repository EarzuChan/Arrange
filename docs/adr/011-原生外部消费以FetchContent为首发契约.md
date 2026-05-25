# ADR 011：原生外部消费以 FetchContent 为首发契约

日期：2026-05-25

## 背景

Arrange 的原生侧需要面向外部用户提供可复现、可链接、可调试的消费方式，但项目当前仍处于快速演进期，原生接口和依赖边界尚未到适合统一二进制分发或中央仓库固化的阶段。

## 决策

Arrange 原生侧首发对外消费契约定为：

```txt
FetchContent source package
```

即外部用户通过 CMake `FetchContent` 将 Arrange 源码包加入自己的构建树，再链接公开 target 使用。

暂不把以下形式作为首发承诺：

```txt
vcpkg
Conan
微软中央仓库二进制包
系统级 install package
```

原生公开 target 语义应固定为命名空间形式，并与后续 install/export 兼容：

```txt
Arrange::core
Arrange::quickjs
Arrange::juce
```

## 影响

- 原生消费边界以源码包和干净构建树为中心。
- demo 和用户样板必须优先走公开消费路径，而不是仓库内部特供路径。
- native 版本与 TS 包版本需要保持可对齐、可诊断的关系。
- `install/export`、CMake helper、xmake helper 与中央仓库适配属于后续增强，不改变首发契约。

## 不做

- 不把 vcpkg / Conan 作为当前阶段首要分发渠道。
- 不把 demo 特供逻辑当成用户正式消费路径。
- 不在旧 ADR 上补写或改写新的分发事实。
