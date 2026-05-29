# ADR 013：Arrange CLI 成为唯一工程编排入口

日期：2026-05-27

## 背景

ADR 012 将外部消费收束为 `@arrange/framework`、`Arrange::framework` 与 `arrange`。随着工程正规化继续推进，`arrange` 的地位必须进一步明确。

标准 Arrange 工程根目录不是 Node 项目，而是由 `arrange.config.yaml`、`ui/`、`native/` 与 `artifacts/` 组成。若把 CLI 作为 `@arrange/framework` 的项目依赖，会迫使根目录承担 Node 项目职责，破坏工程边界。

## 决策

Arrange CLI 成为唯一官方工程编排入口，命令名为 `arrange`，由全局工具包 `@arrange/cli` 提供。

```txt
@arrange/cli -> arrange 命令
@arrange/framework -> UI framework 包
Arrange::framework -> native framework target
```

`@arrange/framework` 不再承担对外 CLI 地位。它是 UI 项目依赖，提供 authoring API、Arrange Vue 与 runtime / toolchain 所需能力。

`Arrange::framework` 仍是 native 侧唯一公开 target。

Arrange CLI 负责创建、收编、同步、开发、构建和打包 Arrange 工程，并把 `@arrange/framework` 写入 `ui/package.json`，把 `Arrange::framework` 写入或维护 native CMake 的 Arrange 区域。

官方不再维护其它并列 CLI 或脚手架入口。

## 影响

- `create-arrange`、framework 内置 CLI、Vite 专用 CLI 等将被收埋，以后只用牢大。
- 工程根目录不是 `Node 项目`，当然也更不会需要 `package.json`。
- `arrange.config.yaml` 是工程配置真源。
- `artifacts/` 是 Arrange CLI 负责整理的最终交付物目录。
- 文档、demo 与后续实现应以 Arrange CLI 作为用户工程入口。

长期事实源见 [Arrange CLI 与工程模式](../arch/31-ArrangeCLI与工程模式.md)。
