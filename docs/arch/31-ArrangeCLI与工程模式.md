# Arrange CLI 与工程模式

本文定义 Arrange 用户工程的长期形态、配置文件、版本规则、命令行为与构建 / 打包权责。它是 Arrange CLI 的母文档。

Arrange CLI 的命令名是 `arrange`。内部因其起的作用（用户工程的“总管”）可称作“牢大”，正式表述（产品名）为 Arrange CLI。

# 地位

Arrange CLI 是 Arrange 工程的全局编排器。它不替代 npm / pnpm、CMake、Vite 或 JUCE，而是调用这些工具完成正确的工作。

```txt
Arrange CLI
-> 管理 Arrange 工程模式
-> 维护 Arrange 负责的工程文件区域
-> 调用包管理器处理 UI
-> 调用 CMake 处理 native
-> 整理最终 artifacts
```

官方对外 CLI 只有 Arrange CLI。有本CLI后，Arrange内部（如framework）不得再有任何其它 CLI，以免分裂生态。

# 包与入口

```txt
@arrange/cli        全局 CLI 包，提供 arrange 命令
@arrange/framework  UI framework 包，由 CLI 写入 ui/package.json
Arrange::framework  native framework target，由 CLI 写入 native CMake
```

用户主要与 `arrange` 命令交互。`@arrange/framework` 不提供任何对外 CLI、bin 或命令入口。

项目根目录不是 Node 项目，而是 Arrange 工程根。工程根不要求 `package.json`。

# 标准工程形态

```txt
project/
  arrange.config.yaml
  ui/
  native/
  artifacts/
```

- `arrange.config.yaml` 是 Arrange 工程唯一配置真源。
- `ui/` 是 TypeScript UI 源码项目。
- `native/` 是 CMake / JUCE native 项目。
- `artifacts/` 是 Arrange CLI 整理后的最终交付物目录。

构建过程中的临时文件仍由对应工具放在自己的默认位置，例如 `native/build/`、`ui/dist/`、`node_modules/`。Arrange CLI 会从这些目录定位产物，但不维护长期 `generated/` 目录。

# 配置文件

Arrange 工程只使用 `arrange.config.yaml`。不提供 JSON、TOML、TypeScript 配置入口，也不提供 `.yml` 别名；文件中不写 schema 版本。

配置文件只描述 Arrange 必须知道的工程事实。它不是通用构建 DSL，不承载任意 CMake / Vite 逻辑。

完整形态：

```yaml
arrange:
  version: 0.0.0-m.2.1

project:
  name: MyPlugin
  version: 0.1.0
  companyName: Earzu
  companyCode: Earz
  pluginCode: Arng
  pluginType: effect
  products:
    - standalone
    - vst3

ui:
  path: ui
  packageManager: pnpm

native:
  path: native
  cmake:
    buildDir: build
    generator: Ninja
    configureArgs: []
    buildArgs: []

artifacts:
  path: artifacts
  includeVersionDir: true
```

## arrange

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `version` | string | 是 | 无 | 当前工程使用的 Arrange 版本。必须是具体版本，不能是 `latest`。 |

`arrange.version` 决定工程使用的 Arrange framework 版本。UI 侧 `@arrange/framework` 与 native 侧 `Arrange::framework` 都跟随该版本。

## project

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `name` | string | 是 | 无 | 项目 / 插件名。 |
| `version` | semver string | 是 | 无 | 用户项目版本，用于 artifacts 版本目录。 |
| `companyName` | string | 是 | 无 | 公司 / 厂牌名。 |
| `companyCode` | string | 是 | 无 | 公司代码。 |
| `pluginCode` | string | 是 | 无 | 插件代码。 |
| `pluginType` | enum | 否 | `effect` | `effect` 或 `instrument`。 |
| `products` | enum[] | 否 | `[standalone, vst3]` | 需要构建和打包的产品类型。 |

M2.2 只承诺：

```txt
pluginType: effect | instrument
products: standalone | vst3
```

VST2、AU、AAX、ARA、CLAP、LV2 等格式不进入 M2.2 官方生成矩阵。

## ui

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `path` | path string | 否 | `ui` | UI 项目目录。相对工程根；外部目录必须显式写。 |
| `packageManager` | enum | 否 | `pnpm` | `pnpm` 或 `npm`。 |

UI 官方模板固定 TypeScript，不提供纯 JavaScript 模板。

## native

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `path` | path string | 否 | `native` | native 工程目录。相对工程根；外部目录必须显式写。 |
| `cmake` | object | 否 | 默认对象 | CMake 调用配置。 |

### native.cmake

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `buildDir` | path string | 否 | `build` | CMake build 根目录。相对 `native.path`。 |
| `generator` | string | 否 | CLI 自动选择 | CMake generator，例如 `Ninja`。 |
| `configureArgs` | string[] | 否 | `[]` | 追加给 `cmake -S -B` 的参数。 |
| `buildArgs` | string[] | 否 | `[]` | 追加给 `cmake --build` 的参数。 |

用户不能在配置文件中自定义构建风味。Arrange CLI 支持两个 flavor：

```txt
debug
release
```

`native.cmake.buildDir` 相对 `native.path`。例如：

```yaml
native:
  path: native
  cmake:
    buildDir: build
```

对应 build 根目录是：

```txt
native/build
```

CLI 应按平台准备 CMake 调用环境。Windows 下可自动寻找并使用 Visual Studio Developer Command Prompt 环境。

## artifacts

| 字段 | 类型 | 必填 | 默认 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `path` | path string | 否 | `artifacts` | 最终交付物根目录。相对工程根。 |
| `includeVersionDir` | boolean | 否 | `true` | 是否在 artifacts 布局中包含 `project.version` 目录。 |

默认布局：

```txt
artifacts/
  <flavor>/
    <version?>/
      <platform>-<arch>/
        <product>/
```

示例：

```txt
artifacts/
  release/
    0.1.0/
      windows-x64/
        standalone/
          ui/
          MyPlugin.exe
        vst3/
          MyPlugin.vst3/
```

若 `includeVersionDir: false`，则省略 `<version?>` 层。

# 版本来源与兼容性

`@arrange/cli` 独立维护其版本。工程使用的 Arrange framework 版本写在 `arrange.config.yaml` 的 `arrange.version`。

Arrange CLI 在代码中持有当前 CLI 兼容性码。`arrange create` / `arrange adopt` 的 Arrange 版本选择来自 npm registry 中 `@arrange/framework` 的包数据。CLI 读取该包的 packument，使用其中的 `dist-tags`、`versions` 和 package metadata 生成候选列表。

`arrange create` / `arrange adopt` 可显式传入 `--registry <url>`。该参数只改变本次向导读取 `@arrange/framework` packument / metadata 的 registry；工程配置中仍只写具体 Arrange 版本。若使用了 `--registry`，CLI 会在 UI 工程写入 `@arrange:registry=<url>` 的 `.npmrc`，使后续 `sync` 与兼容性检查继续使用同一 Arrange 包源。

framework package metadata 的结构见 [内部包构建与分发契约](29-内部包构建与分发契约.md)。

规则：

- 版本候选先展示当前 CLI 的兼容性码。
- 版本候选来自 npm 版本列表与 CLI 内部推荐策略。当前阶段没有 stable 集合时，可展示最新若干版本。
- `latest` 只是候选列表中对应版本的前缀显示，不是独立版本类型。
- 兼容版本不显示 `cliCompatibility`，保持列表清爽。
- 不兼容版本仍展示，但标记为 `不兼容：<该版本的 cliCompatibility>`，且不可选。
- 自定义版本被选中后要求用户输入版本号；输入后读取该版本 metadata 并检查兼容性。通过时新增一条可选候选；不通过时只提示原因，不加入候选列表。
- 用户最终选择的版本写入 `arrange.config.yaml` 时必须是具体版本号，不能是 `latest`。

示例：

```txt
当前 CLI 的兼容性是 2
请选择 Arrange 框架的版本：
> 最新版本  1.1.4-514  稳定版
            1.1.4-513  稳定版
            1.1.4-512  预发行版
            1.1.4-511  稳定版  不兼容：1
            1.1.4-510  稳定版  不兼容：1
            自定义版本
```

sync、dev、build、package 都必须检查 CLI 与工程 Arrange framework 版本的兼容性。不兼容时必须报错，不得默默继续。

# 配置校验

CLI 必须严格校验 `arrange.config.yaml`：

- 未知顶层字段报错。
- 未知 enum 值报错。
- `arrange.version` 不能是 `latest`。
- `project.version` 必须是 semver。
- `project.products` 不能为空。
- `ui.path`、`native.path`、`artifacts.path` 不写时使用默认值。
- 外部路径必须显式写入配置文件。
- YAML 中不支持表达式、变量展开或脚本逻辑。

# 当前目录规则

既有工程命令只读取当前目录的：

```txt
./arrange.config.yaml
```

CLI 不向上级目录查找，不支持隐式 workspace root 推断，不提供 `--config` / `--cwd` / `--root` 来改变工程根。

如果当前目录没有 `arrange.config.yaml`，命令必须报错并要求用户进入 Arrange 工程根或运行 `arrange create` / `arrange adopt`。

# create

`arrange create` 创建新的标准 Arrange 工程。它是交互式命令。除 `--registry <url>` 外，不接收其它参数。

向导收集：

- 项目名。
- 用户项目版本号。
- Arrange 版本。
- 公司名。
- 公司代码与插件代码。
- 插件类型。
- UI 包管理器：`pnpm` 或 `npm`。
- 产品类型：`standalone`、`vst3`。
- 创建目录。
- 创建后是否执行 sync。

向导不暴露以下选择：

- C++ 标准固定为 C++20。
- UI 语言固定为 TypeScript。
- TypeScript 版本由 Arrange 验证版本决定。
- JUCE 版本由 Arrange 验证版本决定。
- QuickJS-NG 版本是 Arrange 内部细节。

创建前必须展示最终信息。用户确认后，CLI 按模板生成 `arrange.config.yaml`、`ui/`、`native/` 与必要工程文件。

# adopt

`arrange adopt` 将已有 native / UI 项目纳入 Arrange 工程模式。它是交互式命令。除 `--registry <url>` 外，不接收其它参数。

流程：

1. 选择 native path；若没有，则进入 native 创建向导。
2. 选择 UI path；若没有，则进入 UI 创建向导。
3. 对已有 UI / native 子工程选择复制或原位引用；若情况不支持原位引用，则不展示该选项。
4. 自动识别可确定的信息。
5. 对缺失或冲突的信息专项询问。
6. 选择创建目录。
7. 展示最终工程信息与将要修改的文件。
8. 用户确认后创建 `arrange.config.yaml` 并接入工程。

复制模式会把子工程复制到 Arrange 工程目录，之后不依赖原路径。原位引用模式会在 `arrange.config.yaml` 中指向外部目录；CLI 可以正常开发、构建和打包，但编辑器工作区、相对路径和版本管理体验由用户自行处理。

自动识别只用于给向导提供默认值。识别不到的信息必须询问用户；复杂 CMake 不靠猜测强行改写。

# 工程文件维护

`create` 可以整篇生成工程文件。工程创建后，Arrange CLI 只维护明确属于 Arrange 的部分。

CMake 使用 managed region。每个 region 必须表示一个具体事务：

```cmake
# arrange:begin fetchcontent
...
# arrange:end fetchcontent

# arrange:begin link-framework
...
# arrange:end link-framework
```

CLI 只重写完整、未损坏的 managed region。region 缺 begin/end、重复、嵌套或损坏时，CLI 跳过该文件，报告错误，并说明用户应如何修复。

`package.json` 使用语义维护。CLI 可以添加或更新 Arrange 负责的字段，例如 `dependencies["@arrange/framework"]`；不得删除未知字段，不得覆盖用户脚本。Arrange CLI 不依赖 `package.json` scripts，若已有 `dev` / `build` / `package` 等脚本，CLI 应提示这些脚本不参与 Arrange 官方流程。

# sync

`arrange sync` 让工程与 `arrange.config.yaml` 对齐。它包含两层：

1. project sync：维护 Arrange 负责的工程文件区域，例如 CMake managed region 与 UI `package.json`。
2. toolchain sync：调用外部工具做预同步，例如 `pnpm install` / `npm install` 与 CMake configure。

无参数时：

```txt
project sync + toolchain sync
ui + native
```

参数：

| 参数 | 说明 |
| :--- | :--- |
| `--project-only` | 只执行 project sync，不运行外部工具。 |
| `--toolchain-only` | 只执行 toolchain sync，不修改工程文件。 |
| `--ui` | 只作用于 UI。 |
| `--native` | 只作用于 native。 |
| `--check` | 只检查，不写文件，不运行外部工具。 |

组合规则：

- `--project-only` 与 `--toolchain-only` 互斥。
- `--ui` 与 `--native` 互斥。
- `--check` 可与 `--ui` 或 `--native` 组合。
- 例如 `arrange sync --ui --project-only` 合法。

sync 遇到正常文件可自动维护；遇到损坏或无法安全处理的文件必须跳过并打印明确修复说明。

# dev

`arrange dev` 启动开发环境。

无参数默认行为：

```txt
启动 UI dev server + native debug standalone
```

参数：

| 参数 | 说明 |
| :--- | :--- |
| `--ui-only` | 只启动 UI dev server。 |
| `--native-only` | 只启动 native Standalone。 |
| `--flavor debug` | 使用 debug 风味。 |
| `--flavor release` | 使用 release 风味。 |

规则：

- 默认 flavor 是 `debug`。
- `--ui-only` 与 `--native-only` 互斥。
- `--flavor` 只影响 native。
- dev 不执行 package。
- dev 不静默修改工程文件；工程不同步时应提示用户运行 `arrange sync`。

# build

`arrange build` 构建工程。无参数默认行为：

```txt
release flavor
build UI
build native
package artifacts
```

参数：

| 参数 | 说明 |
| :--- | :--- |
| `--flavor debug` | 使用 debug 风味。 |
| `--flavor release` | 使用 release 风味。 |
| `--ui-only` | 只构建 UI，不 package。 |
| `--native-only` | 只构建 native，不 package。 |
| `--no-package` | 完整 build，但不整理 artifacts。 |
| `--product standalone` | 只处理 standalone，可重复传。 |
| `--product vst3` | 只处理 vst3，可重复传。 |

规则：

- 默认 flavor 是 `release`。
- `--ui-only` 与 `--native-only` 互斥。
- `--product` 不传时使用 `project.products`。
- 单独构建 UI 或 native 时不执行 package。
- build 不静默修改工程文件；工程不同步时应提示用户运行 `arrange sync`。

# package

`arrange package` 只整理已有构建产物。它不编译、不 install、不 configure。

无参数默认行为：

```txt
release flavor
package project.products 中的全部产品
```

参数：

| 参数 | 说明 |
| :--- | :--- |
| `--flavor debug` | 使用 debug 风味。 |
| `--flavor release` | 使用 release 风味。 |
| `--product standalone` | 只整理 standalone，可重复传。 |
| `--product vst3` | 只整理 vst3，可重复传。 |
| `--clean` | 先清理本次将要写入的 artifacts product 目录。 |

规则：

- 默认 flavor 是 `release`。
- `--product` 不传时使用 `project.products`。
- 找不到既有产物必须明确报错。

# native 产物定位

CLI 定位 native 产物时按以下顺序：

1. 使用配置文件和 CMake target 信息推导。
2. 使用 CMake File API / codemodel 获取 target artifact。
3. 按产品类型验证产物特征，例如 Standalone 可执行文件 / app bundle、VST3 bundle。
4. 找不到时明确报错，不做全盘乱扫。

# 边界

Arrange CLI 只是总管，不做以下事情：

- 不替代 CMake 编译 native。
- 不替代 npm / pnpm。
- 不做通用 monorepo 管理器：本 CLI 仅能管理我们 Arrange 的工程。
- 不承诺理解任意复杂 CMake 工程。
- 不支持纯 JavaScript 官方模板。
- 绝不能维护多个“CLI”；只此一家。
