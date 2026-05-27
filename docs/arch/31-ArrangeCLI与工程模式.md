# Arrange CLI 与工程模式

本文定义 Arrange 用户工程的长期形态、唯一 CLI 入口与构建 / 打包权责。它是 Arrange CLI 的母文档。

Arrange CLI 因其“开发过程中的统治性地位”而在内部可称作“牢大”，正式名称写作 Arrange CLI，命令名是 `arrange`。

# 地位

Arrange CLI 是 Arrange 工程的全局编排器。它不替代 npm / pnpm、CMake、Vite 或 JUCE，而是调用这些工具完成正确的工作。

```txt
Arrange CLI
-> 管理 Arrange 工程模式
-> 调用包管理器构建 UI
-> 调用 CMake 构建 native
-> 整理最终 artifacts
```

官方对外 CLI 只有 Arrange CLI。严禁再有什么 `create-arrange`、framework 内置 CLI、Vite 专用 CLI 或其它玩意，这是非法的、反动的分裂生态、多头维护，必须禁绝和消灭。

# 包与入口

```txt
@arrange/cli # 全局 CLI 包，提供 arrange 命令
@arrange/framework # UI framework 包，写入 ui/package.json
Arrange::framework # native framework target，写入 native CMake
```

用户主要与 `arrange` 命令交互。

项目根目录不是 Node 项目，而是我们自己的根工程模式。

# 标准工程形态

```txt
project/
  arrange.config.ts
  ui/
  native/
  artifacts/
```

- `arrange.config.ts` 是 Arrange 工程唯一配置真源。
- `ui/` 是 TypeScript UI 源码项目。
- `native/` 是 CMake / JUCE native 项目。
- `artifacts/` 是 Arrange CLI 整理后的最终交付物目录。

构建过程中的临时文件仍由对应工具放在自己的默认位置，例如 `native/build/`、`ui/dist/`、`node_modules/`，我们是会自动从里面“打捞工件”，而不另外画蛇添足搞一个什么 `/generated`。

# 配置文件

Arrange 工程只使用 `arrange.config.ts`。不另提供 JSON、YAML 或 TOML 配置入口。

配置文件描述 Arrange 必须知道的工程事实：名称、版本、native root、ui root、包管理器、产物类型、artifacts 布局等。它不是通用构建 DSL，不承载任意 CMake / Vite 逻辑。

# create

`arrange create` 创建新的标准 Arrange 工程。向导收集：

- 项目名。
- 统一，符合相应规范的版本号。
- JUCE的公司名。
- JUCE的公司代码与插件代码。
- JUCE的插件类型。
- UI的包管理器：`pnpm`（推荐）或 `npm`。
- JUCE的产物类型（多选题，Standalone、VST3）。
- Scaffolding project in 如 `./<your-project-name>`（用户可编辑。删掉<子目录>就直接在cli的运行路径下创建）

向导不可选：

- C++ 标准为 C++20。
- UI 语言为 TypeScript：我们坚持ts-first。
- TypeScript 版本由 Arrange 验证版本决定。
- JUCE 版本由 Arrange 验证版本决定。
- QuickJS-NG 版本是 Arrange 内部细节。

创建前必须展示最终信息。用户确认后，CLI 按模板生成 `arrange.config.ts`、`ui/`、`native/` 与必要工程文件。

# adopt

`arrange adopt` 将已有 native / UI 项目纳入 Arrange 工程模式。adopt 也必须走向导流程。

流程：

- 选择 native path；若没有，则进入 native 创建向导。
- 选择 UI path；若没有，则进入 UI 创建向导。
- 对ui、native选择复制或原位引用（若情况特殊不可原位引用，则不会呈现选择）。
- 自动识别可确定的信息。
- 对缺失或冲突的信息专项询问。
- Scaffolding project in 如 `./<your-project-name>`（用户可编辑。删掉<子目录>就直接在cli的运行路径下创建）
- 展示最终工程信息与将要修改的文件。
- 用户确认后创建 `arrange.config.ts` 并接入工程。

复制模式会把子工程复制，之后不再依赖原路径的东西。原位引用模式会在 `arrange.config.ts` 中指向外部目录；CLI 可以正常开发、构建和打包，但编辑器工作区、相对路径和版本管理体验由用户自行处理。

# 工程文件维护

`create` 可以整篇生成工程文件。工程创建后，Arrange CLI 只维护明确属于 Arrange 的部分。

CMake 使用 managed region：

```txt
# arrange:begin managed framework
<我们维护的内容>
# arrange:end managed framework
```

CLI 只重写 managed region。没有 managed region 时，CLI 不静默改写 CMake；adopt 或 doctor 可提出补丁，由用户确认。

`package.json` 使用语义维护。CLI 可以添加或更新 `@arrange/framework`、必要 scripts 与 Arrange 相关字段；不得删除未知字段，不得覆盖用户脚本而不确认。

# dev / build / package

`arrange dev` 启动开发环境。默认面向完整 Arrange 工程：UI dev server 与 native 开发入口由 CLI 编排。

`arrange build` 默认执行完整构建并顺带 package。它内部仍分为两个阶段：

1. build phase：调用包管理器 / Vite 构建 UI，调用 CMake 构建 native。
2. package phase：把已有 UI 与 native 产物整理到 `artifacts/`。

`arrange build --no-package` 只执行 build phase。

`arrange package` 不重新编译，只整理已有构建产物。

# artifacts

Arrange CLI 的最终交付物根目录是 `artifacts/`，不是 `dist/`。`dist/` 只允许作为 UI 项目内部构建输出概念。

官方默认布局：

```txt
artifacts/
  <profile>/
    <version>/
      <product>/
```

示例：

```txt
artifacts/
  debug/
    0.1.0/
      Windows Standalone/
        ui/
        MyPlugin.exe
```

是否保留版本号目录由 `arrange.config.ts` 控制；官方模板默认保留。

# doctor

`arrange doctor` 检查工程是否满足 Arrange 协议。它可以报告缺失依赖、CMake 未接入 `Arrange::framework`、UI 项目未依赖 `@arrange/framework`、版本不一致、artifacts 布局冲突等问题。

`doctor` 不应擅自修改文件；修复必须显式确认。

# 边界

Arrange CLI 只是总管地位，不会：

- 替代 CMake 来编译 native。
- 替代 npm / pnpm。
- 通用 monorepo 管理器：本 CLI 仅能管理 Arrange 工程。
- 理解任意复杂 CMake 工程。