# Arrange

[![npm version](https://img.shields.io/badge/npm%20%7C%20%40arrange%2Fframework-0.0.0--m.3.0-CB3837?style=flat-square)](https://www.npmjs.com/package/@arrange/framework)
[![cmake version](https://img.shields.io/badge/cmake%20%7C%20FetchContent-0.0.0--m.3.0-064F8C?style=flat-square)](https://github.com/EarzuChan/Arrange)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](https://opensource.org/license/MIT)

[English](README_EN.md)

适用于 JUCE（跨平台音频产品开发）的反应式、声明式UI框架，受到 Jetpack Compose（下称 Compose）的整体启发、开发者体验深度改造自 Vue.js。

![LOGO](artworks/logo.png)

> 项目名称取于一个对仗：在音乐语境下，Compose 常意为作曲，而 Arrange 则常意为编曲，故取 Arrange 之名，以示致意。

Arrange 是一个 TypeScript/C++ 混合框架，您可通过在 Node.js 项目中使用我们的 SFA（单文件型可编排项）或标准 TypeScript 来开发 UI（热更新也是受支持的），在 C++ 侧轻松“启动APP”。我们通过内建的 QuickJS-NG 实现对 UI 脚本以及 HMR 的支持，而具体的重排、测量、放置、绘制算法则是我们自己写的（当然，整体思想借鉴 Compose），绘制是直接对接 juce::Graphics，Arrangables（可编排项）不会被映射为 juce::Component。

Arrange 另提供有一套自研 CLI（以面向用户为主），以方便您创建、同步、调试、构建、打包您的工程。

> 更详细的文档、更多信息，请您访问[官方网站](https://arrange.earzuchan.me/)。

## 好处：

1. 通过优雅的 SFA 写法、热更新，以更现代（声明式 UI、反应式精准更新、热更新即时体现 UI 修改）更方便更优雅的体验来开发音频产品（插件和软件），大大降低开发难度。
2. CLI 强力驱动开发体验，开发 JUCE 不用再苦思配环境和苦恼编译问题，一次开发、多端轻松调试和部署。

## 提示（or 弊端）

1. Arrange 并非 Web UI 框架或者 WebView 套壳，其不支持、不沿用 Web 写法（如 HTML Elements、HTML Styles、CSS），且 Arrangable 也和 HTML Element 具有很大不同，SFA 模板也不是 HTML Document，请知晓。Arrange 也不承诺任意 JS 或标准 Vue.js 库和框架能在 Arrange 场景下沿用。未来 Arrange 计划提供如导航、状态等的更多能力，尚待考虑和开发。
2. 由于 UI 侧需要使用 JS 引擎，在复杂场景下，性能或者效果可能不如原生，占用也或会偏大。
3. CLI 不一定能处理全场景问题，遇到某些复杂或极少见的情况，或许需要您（或者 AI AGENT）亲自调整修正。
4. Arrange 尚处于早期开发阶段且在持续快速演进，API 和各项能力可能会被更改或者移除，请注意。

## 提供的设施

- **@arrange/framework**：npm（Node.js）侧 Arrange 框架的包。
- **Arrange::framework**：CMake（C++）侧 Arrange 框架的包。
- **@arrange/cli**：Arrange 的 CLI（命令为 `arrange`），**需要全局安装以方便您的使用**。

## SFA 与整体开发体验

SFA（Single-File Arrangable，单文件型可编排项）使用 `.sfa` 扩展名，将 UI 的模板与 TypeScript 逻辑放在同一个文件中：`<template>` 描述界面结构，`<script>` 声明状态、事件处理和可复用逻辑。熟悉 Vue 的朋友应该会感到亲切（但是注意：Arrange 不支持那些 Web 的东西；熟悉的只是模板写法，而底层逻辑大有不同），熟悉 Compose 的朋友则会在布局与 Modifier 上找到熟悉的味道。

编写 UI 时，您可以把界面看成由一组 Arrangables（可编排项）组合而成：`Text` 显示文字，`Image` 显示图片，`Row` 和 `Column` 分别横向、纵向排列内容，`Box` 则用于容纳和叠放内容。把它们组合起来，再拆成自己的 `.sfa` 文件，就能逐步搭出完整界面。

例如，一个带计数交互的小面板可以这样写：

```sfa
<template>
    <Column :modifier="M.fillMaxSize().background(Color(0xff17212e)).padding(24.dp)" :vertical-arrangement="Arrangement.spacedBy(16.dp)">
        <Row :horizontal-arrangement="Arrangement.spacedBy(12.dp)">
            <Box :modifier="M.size(24.dp, 24.dp).background(Color(0xff66ccff))"/>

            <Text text="Hello, Arrange!" :style="{ fontSize: 24.sp, color: Color(0xfff4f6fa) }"/>
        </Row>

        <Text :text="'点击次数：' + count" :modifier="M.background(Color(0xff336699)).clickable(increment).padding(12.dp)" :style="{ fontSize: 18.sp, color: Color(0xffffffff) }"/>
    </Column>
</template>

<script>
import { ref } from '@arrange/framework'
import { Box, Column, Row, Text } from '@arrange/framework/foundation'
import { Arrangement, Color, M } from '@arrange/framework/ui'

const count = ref(0)

function increment() {
    count.value += 1
}
</script>
```

这里的 `count` 是反应式状态：点击文字会执行 `increment`，状态变化后，界面中的计数随之更新。模板中的 `:text`、`:modifier` 等冒号绑定接收表达式；模板会自动读取本地 `ref` 的值，而脚本中通过 `.value` 访问它。

尺寸、间距、背景、边框和点击等行为可以通过 `M` 构造的 **有序 Modifier 链**描述，例如 `M.width(200.dp).background(Color(0xff336699)).padding(12.dp)`；文字的字号、颜色等则通过 `Text` 的 `style` 参数设置。SFA 支持 `dp`、`sp` 等单位写法，`Color(0xff336699)` 使用 ARGB 颜色值。Modifier 按链中的顺序组合，调整顺序也会影响布局、绘制或交互范围。

开发时，您主要围绕“当前状态下，界面应该是什么样”（声明式思想）来组织代码。UI 文件保存后，在正在运行的 JUCE 窗口中会将变化热更新（无需重启或重新编译）；需要扩展音频处理或原生能力时，再进入 C++ 子项目开发。

## 用起来（Getting Started）

目前支持 Windows x64 与 macOS x64/arm64。开始前，请准备：

- **Node.js 24 或更新版本**（含 npm）、**Git**。欲使用 pnpm 作为包管理器，则应准备好 pnpm。
- **CMake 3.24 或更新版本**；使用默认 Ninja 生成器时，还需安装 **Ninja**。
- **C++ 工具链**：Windows 安装 Visual Studio 或 Build Tools，并选中“使用 C++ 的桌面开发”（包含 MSVC 和 Windows SDK）；macOS 安装 Xcode Command Line Tools 或完整 Xcode。

CLI 会检测本机工具，并在准备工程时获取 Framework、JUCE、QuickJS-NG 等依赖；首次准备和编译需要一些时间，也需要能够访问 npm 与 GitHub。请在正常的交互式终端中执行以下命令。

**1. 安装 CLI，创建工程**

```sh
npm install -g @arrange/cli
arrange create
```

跟随向导填写工程信息。第一次尝试时，可以将工程名设为 `MyFirstArrange`，选择创建到 `./MyFirstArrange`，使用默认的 `ui`、`native`、`artifacts` 目录，选择最新的 Framework 版本，并启用 **Standalone** 产品，方便直接启动窗口调试。其余选项按提示填写、确认生成计划即可。

**2. 准备环境，跑起来**

创建完成后，进入生成的工程根目录：

```sh
cd MyFirstArrange
arrange sync
arrange dev
```

`arrange sync` 会检查并同步工程配置、安装 UI 依赖、检测工具链并准备原生构建环境；若创建向导中已经完成了完整同步，可以略过这一步。`arrange dev` 默认以 Debug 模式启动 UI 开发服务，编译并打开 Standalone 窗口。CLI 命令完成后会停屏供您查看结果，按 Enter 返回终端，再执行下一条命令。

窗口中会出现工程标题和可点击的计数文字。点击计数，确认反应式更新已经工作。

**3. 修改 SFA，观察热更新**

保持 `arrange dev` 运行，用编辑器打开 `ui/src/App.sfa`。找到脚本中的 `projectTitle`，将它改成：

```ts
const projectTitle = '我的第一个 Arrange 界面'
```

保存文件，观察已打开窗口中的标题随之变化。再将模板里根 `Column` 的背景色从 `Color(0xff17212e)` 改成 `Color(0xff243447)`，保存后就能看到背景更新。您也可以把整个文件替换成上一节的小面板，继续尝试布局、样式与点击交互。这些 UI 修改通过热更新生效，无需重新编译 C++ 或手动重开窗口。

开发会话就绪后，可按终端提示用 Esc 或 Ctrl+C 正常停止，再按 Enter 返回终端。准备生成发布产物时，在工程根目录运行：

```sh
arrange build
```

它默认执行 Release 构建并整理交付物，最终位置由 CLI 显示，默认位于工程的 `artifacts/` 目录下。已有 JUCE 工程可以使用 `arrange adopt` 接入。

## 开发

目前系我（EARZU CHAN）独立开发维护为主，当然也欢迎您对本项目添砖加瓦（推荐您联系我先）。开发性的相关文档都在[此目录下](docs/)，敬请参阅。

## 写在最后

- 联系我：contact@earzuchan.me

### 本项目

- 最早受到了 [React-JUCE](https://github.com/JoshMarler/react-juce) 的部分启发，但实现路线截然不同（我们采用更现代更快的 QuickJS-NG 引擎（非 Duktape），使用自研的测量与布局设施（非 Yoga），也不把组件树映射为 `juce::Component`，而是由 Arrange 自行处理）。
- 基于 [MIT](LICENSE) 协议开源，若对您有帮助，请 Star。本项目借鉴了 Compose 的思想，包含源自 Vue.js 的代码，并依赖 JUCE、QuickJS-NG 等项目，详见[第三方声明](THIRD_PARTY_NOTICES.md)。使用本项目开发商业产品时，请特别注意 JUCE 的许可证要求。
- 在开发过程中使用了 OpenAI GPT、Anthropic Claude 等人工智能辅助。
- 本项目仍在持续优化中，力求给您提供“能用、可用”的体验，但不作任何生产环境可用性保证；请您自行评估是否用于生产环境，使用风险需自行承担。