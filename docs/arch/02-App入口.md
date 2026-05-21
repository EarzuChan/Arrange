# 主模型

Arrange 的公开入口是 `ArrangeEditor`。用户在 JUCE 侧直接返回一个 Editor，Arrange 托管整个 Editor UI。

目标 API：

```cpp
arrange::juce::EditorConfig config;

config.app.useDist("../ui");
config.app.useLive();

return new arrange::juce::ArrangeEditor(*this, std::move(config));
```

`useLive(...)` 与 `useDist(...)` 是 App source 配置。若用户没有配置任何 source，Arrange 必须进入错误屏并说明没有可加载 App，核心文案固定包含：`你啥也没给我给你加载啥app（笑）`。

# 两个 ui 概念

## UI 源码项目

这是用户的 Node/Vite 项目，可以叫 `ui-src/`、`frontend/` 或别的名字。

```txt
ui-src/
  package.json
  vite.config.ts
  src/main.ts
  src/App.vue
```

## 运行时 ui 目录

常指插件发布包下、可执行文件旁边或资源目录里的 `ui/`。它是一个 UI 产物包目录；不要求 manifest。

```txt
ui/
  app.js
  chunks/...
  assets/...
  其他入口文件（可选）
```

`useDist("../ui")` 指 UI 产物包目录，不是 UI 项目源码目录。若用户显式传其他目录，则按显式路径加载。

# App source API

```cpp
config.app.useDist(); // 默认
config.app.useDist("../ui"); // 显式指定
config.app.useLive();
config.app.useLive("http://host:port");
```

规则：

- `useLive(...)` 的参数可缺省，缺省时使用 `http://127.0.0.1:9178`。
- `useDist(...)` 的参数可缺省，缺省时使用约定 `ui/` 产物包目录。
- Debug Demo 推荐同时配置 `useLive()` 与 `useDist("../ui")`。
- Release 推荐只配置 `useDist(...)`。

# JS 入口

源码项目入口负责 `createApp` 与应用配置：

```ts
import { createApp } from "@arrange/runtime"
import App from "./App.vue"

createApp(App).mount()
```

正式 authoring 路径为 SFC / template / render function，经 Arrange Vue compiler / runtime 进入 Composition mutations 与 Reactive slot updates。`@arrange/runtime` 是 authoring API 主入口。

# 路径约定

`useDist("../ui")` 相对调用处源文件位置解析，不依赖 DAW 当前工作目录。

# Debug 加载

每次加载、刷新、错误重试、HMR reload 都按同一规则执行：

```txt
if live enabled:
  try live
  if success return
if dist enabled:
  try dist
  if success return
show error
```

live 地址发现优先级：

```txt
显式 useLive(url)
-> ARRANGE_DEV_SERVER
-> http://127.0.0.1:9178
```

Debug 下需要支持手动操作：

- `F5`：按当前配置重新加载。
- `Ctrl+F5`：切换 live enabled 状态后重新加载。

# Release 加载

发布模式不连接开发服务器，只加载约定产物包目录或用户显式指定的产物包目录。默认目录是 `ui/`。

# 运行状态可见

Editor 内统一绘制运行状态 badge：

- `Debug live`
- `Debug dist`
- `Release dist`

Standalone 额外尝试把标题栏设置为 `Arrange Demo [live]` 或 `Arrange Demo [dist]`。VST3 宿主外层标题栏不作为可靠显示渠道。

badge、标题、toast、错误屏与日志的统一约束见 [开发期诊断表层](25-开发期诊断表层.md)。

# Window / Editor config

`EditorConfig` 应包含窗口行为配置：

```cpp
config.window.title = "Arrange Demo";
config.window.resizable = true;
config.window.useCornerResizer = true;
config.window.minWidth = 360;
config.window.minHeight = 240;
config.window.maxWidth = 4096;
config.window.maxHeight = 4096;
```

Standalone 应尽量完整尊重这些配置；插件宿主中按宿主允许范围尽力尊重。

# 原则

- Authoring 上是 App。
- 实现上可分 Runtime、SceneHost、VBlankSource adapter、SceneFramePipeline 与 passive paint adapter。
- 加载 source 必须显式、可诊断、可重试。
- 必要信息写在代码里；CMake、宏、打包工具只作为可选增强。



