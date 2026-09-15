# Arrange CLI 与工程模式

本文是 Arrange CLI 的长期事实源，定义用户可见的工程形态、配置文件、命令职责与参数。CLI 的内部托管模型见 [Arrange CLI 托管与同步模型](32-ArrangeCLI托管与同步模型.md)。

## 地位

Arrange CLI 是唯一官方工程编排入口，命令名为 `arrange`，由 `@arrange/cli` 提供。它编排工程，调用包管理器、Vite、CMake 与 JUCE，而不是代替这些工具。

```txt
@arrange/cli -> arrange 命令
@arrange/framework -> UI authoring 与运行时入口
Arrange::framework -> native 唯一公开 target
```

`@arrange/framework`、`@arrange/vite-plugin` 和其它内部包绝不得再提供任何 CLI，以免精神分裂。

## 标准工程

```txt
project/
  arrange.project.yaml
  arrange.local.yaml
  .arrange/
  ui/
  native/
  artifacts/
```

工程根不是 Node workspace，根目录不要求 `package.json`。`ui/` 是 TypeScript UI 子项目，`native/` 是 CMake/JUCE 子项目，`artifacts/` 是 CLI 整理的交付物目录。

`.arrange/` 是 CLI 生成的本机工作目录，保存事务记录和未来缓存，不提交到 Git；它不承载团队共享配置。

既有工程命令都在当前目录寻找 `arrange.project.yaml`，不向上推断工程根，也不提供 `--cwd`、`--root` 或隐式 workspace 规则。create 与 adopt 可以在当前目录建立新的工程根。

## 配置分工

`arrange.project.yaml` 是项目基本共享事实，提交到 Git；`arrange.local.yaml` 是本机特异配置，不应提交。前者描述项目、UI、native、framework 版本、产品和托管项，后者描述当前机器如何调用 Node、包管理器、CMake、Ninja、MSVC 或 Xcode。

`ProjectState` 是 CLI 运行时读取的统一状态，包含 `rootDir`、`project` 和 `local`。`rootDir` 是本次操作的实际工程位置，不得搞额外的上下文对象。

## 命令

```bash
arrange create [--registry <url>] [--fetch-content <url>]
arrange adopt  [--registry <url>] [--fetch-content <url>]
arrange sync   [--scan] [--config | --setup] [--ui | --native]
arrange dev    [--ui-only | --native-only] [--flavor debug|release]
arrange build  [--flavor debug|release] [--ui-only | --native-only]
                [--no-package] [--product standalone|vst3]... [--clean]
arrange package [--flavor debug|release] [--product standalone|vst3]... [--clean]
```

`--config` 与 `--setup` 互斥；`--ui` 与 `--native` 互斥。省略范围表示同时处理 UI 与 native。`sync --scan` 只扫描并详细地报告情况，不写文件、不改配置、不运行外部工具。

### create

交互式创建标准工程。向导收集项目元数据、framework 版本、包管理器、产品和托管项，确认后通过统一的 File／Cluster／Region 定义生成工程文件。未启用托管的内容仍可在创建时生成，但不写 wrapper，也不参加后续 sync。

### adopt

交互式收编已有 UI/native 工程。它识别可确定的结构，让用户确认托管关系和复制／原位引用方式；无法确定的内容交给用户处理，不强行改写。adopt 使用与 create、sync 相同的 File／Cluster／Region 模型。

### sync

同步工程文件、项目配置和本机工具链。sync 的 CONFIG／SETUP 两部分都遵循 [SCAN → RESOLVE → APPLY](32-ArrangeCLI托管与同步模型.md)；`--config` 或 `--setup` 可限制部分。

### dev

检查同步和工具链状态，按选择启动 UI dev server、native 开发程序或二者，并监管长进程。dev 不静默修改工程配置。

### build

按 flavor 和 product 构建 UI/native，默认在完整构建后执行 package。`--ui-only`、`--native-only` 或 `--no-package` 可缩小范围。

### package

只整理已经存在的 UI/native 构建产物到 `artifacts/`，不 install、不 configure、不 build。

## 版本与兼容性

工程记录具体 Arrange framework 版本，不使用 `latest`。CLI 从 registry 读取 framework metadata 并检查 `cliCompatibility`；sync、dev、build、package 在执行前都必须拒绝不兼容组合。

## 工具链

需要外部工具的命令先读取并校验 `arrange.local.yaml`。缺失或失效时进入 SETUP，探测、询问、验证并写回本机配置。Windows native 命令必须在已验证的 Visual Studio Developer Command Prompt 环境中执行。所有外部进程都经过统一执行入口。

## 产物布局

默认布局为 `artifacts/<flavor>/<version?>/<platform>-<arch>/<product>/`。Standalone 和 VST3 的具体平台目录与 UI 资源位置由 package 阶段根据实际产物确定。

## 事实源关系

- 用户可见 CLI、工程目录和命令：本文。
- File／Cluster／Region、ManagedItem、sync 状态机与 `.arrange/`： [32-ArrangeCLI托管与同步模型](32-ArrangeCLI托管与同步模型.md)。
- 本期施工状态：`docs/proj/m2/2/` 下的 M2.2 文档。
