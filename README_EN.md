# Arrange

[![npm version](https://img.shields.io/badge/npm%20%7C%20%40arrange%2Fframework-0.0.0--m.3.0-CB3837?style=flat-square)](https://www.npmjs.com/package/@arrange/framework)
[![cmake version](https://img.shields.io/badge/cmake%20%7C%20FetchContent-0.0.0--m.3.0-064F8C?style=flat-square)](https://github.com/EarzuChan/Arrange)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](https://opensource.org/license/MIT)

[简体中文](README.md)

A reactive, declarative UI framework for JUCE (cross-platform audio product development). Its overall design is inspired by Jetpack Compose (hereafter "Compose"), and its developer experience is a deep rework of Vue.js.

![LOGO](artworks/logo.png)

> The name comes from a pairing: in music, *Compose* usually means writing the music, while *Arrange* means orchestrating it. The name Arrange is a nod to Compose.

Arrange is a hybrid TypeScript/C++ framework. You write your UI in a Node.js project using SFAs (Single-File Arrangables) or plain TypeScript, with hot reloading supported, and simply "start the app" from the C++ side. UI scripts and HMR run on an embedded QuickJS-NG engine, while rearrangement, measurement, placement and drawing are implemented by Arrange itself (following Compose's ideas). Drawing goes straight to `juce::Graphics`; Arrangables are **not** mapped to `juce::Component`s.

Arrange also ships its own CLI, which helps you create, sync, dev, build and pack your projects.

> For more detailed documentation and information, visit the [official website](https://arrange.earzuchan.me/).

## Benefits

1. Build audio products (plugins and applications) with a more modern, convenient and elegant workflow: concise SFA syntax, declarative UI, fine-grained reactive updates, and hot reloading that shows UI changes instantly. This greatly lowers the barrier to JUCE UI development.
2. A CLI-driven workflow: no more wrestling with JUCE environment setup or build issues. Develop once, then debug and deploy across platforms with ease.

## Notes & Trade-offs

1. Arrange is **not** a web UI framework or a WebView wrapper. It does not support or adopt web conventions (HTML elements, HTML styles, CSS). Arrangables differ greatly from HTML elements, and SFA templates are not HTML documents. Arrange also does not promise that arbitrary JS libraries, or standard Vue.js libraries and frameworks, will work in Arrange. More capabilities, such as navigation and state management, are still under consideration.
2. Because the UI runs on a JS engine, performance or visual quality may fall short of native code in complex scenarios, and resource usage may be higher.
3. The CLI may not handle every scenario. In complex or unusual cases, you (or your AI agent) may need to adjust things by hand.
4. Arrange is in early development and evolving quickly. APIs and capabilities may change or be removed.

## What's Included

- **@arrange/framework**: the Arrange framework package for npm (Node.js).
- **Arrange::framework**: the Arrange framework package for CMake (C++).
- **@arrange/cli**: the Arrange CLI (command `arrange`). **Install it globally for convenience.**

## SFA and the Development Experience

An SFA (Single-File Arrangable) uses the `.sfa` extension and keeps a UI's template and TypeScript logic in one file: `<template>` describes the UI structure, and `<script>` declares state, event handlers and reusable logic. Vue users should feel at home (but note that Arrange supports none of the web-specific parts; only the template syntax is familiar, and the underlying model is very different). Compose users will recognize the approach to layout and Modifiers.

Think of a UI as a composition of Arrangables: `Text` displays text, `Image` displays images, `Row` and `Column` lay content out horizontally and vertically, and `Box` contains and stacks content. Combine them, split them into your own `.sfa` files, and build up a complete UI step by step.

For example, a small panel with a click counter looks like this:

```sfa
<template>
    <Column :modifier="M.fillMaxSize().background(Color(0xff17212e)).padding(24.dp)" :vertical-arrangement="Arrangement.spacedBy(16.dp)">
        <Row :horizontal-arrangement="Arrangement.spacedBy(12.dp)">
            <Box :modifier="M.size(24.dp, 24.dp).background(Color(0xff66ccff))"/>

            <Text text="Hello, Arrange!" :style="{ fontSize: 24.sp, color: Color(0xfff4f6fa) }"/>
        </Row>

        <Text :text="'Clicks: ' + count" :modifier="M.background(Color(0xff336699)).clickable(increment).padding(12.dp)" :style="{ fontSize: 18.sp, color: Color(0xffffffff) }"/>
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

Here `count` is reactive state: clicking the text runs `increment`, and when the state changes, the count shown in the UI updates. Colon bindings such as `:text` and `:modifier` take expressions. Templates unwrap local `ref`s automatically, while scripts access them through `.value`.

Size, spacing, background, border and click behavior are described with an **ordered Modifier chain** built from `M`, e.g. `M.width(200.dp).background(Color(0xff336699)).padding(12.dp)`. Text properties such as font size and color are set through `Text`'s `style` parameter. SFA supports unit syntax such as `dp` and `sp`, and `Color(0xff336699)` takes an ARGB value. Modifiers are applied in chain order, so reordering them changes layout, drawing or the interactive area.

During development, you mostly organize code around "what the UI should look like in the current state" (the declarative mindset). When you save a UI file, the change is hot-reloaded into the running JUCE window, with no restart or recompilation. When you need to extend audio processing or native capabilities, you work in the C++ subproject.

## Getting Started

Windows x64 and macOS x64/arm64 are currently supported. Before you begin, make sure you have:

- **Node.js 24 or newer** (with npm) and **Git**. To use pnpm as your package manager, have pnpm installed.
- **CMake 3.24 or newer**; with the default Ninja generator, **Ninja** is also required.
- **A C++ toolchain**: on Windows, Visual Studio or Build Tools with the "Desktop development with C++" workload (includes MSVC and the Windows SDK); on macOS, the Xcode Command Line Tools or full Xcode.

The CLI detects your local tools and fetches dependencies such as the Framework, JUCE and QuickJS-NG when preparing a project. The first preparation and build take a while and require access to npm and GitHub. Run the following commands in a regular interactive terminal.

**1. Install the CLI and create a project**

```sh
npm install -g @arrange/cli
arrange create
```

Follow the wizard to fill in your project details. For a first try, name the project `MyFirstArrange`, create it at `./MyFirstArrange`, keep the default `ui`, `native` and `artifacts` directories, choose the latest Framework version, and enable the **Standalone** product so you can launch a window directly for debugging. Fill in the remaining options as prompted and confirm the generation plan.

**2. Prepare the environment and run**

Once the project is created, go to its root directory:

```sh
cd MyFirstArrange
arrange sync
arrange dev
```

`arrange sync` checks and syncs the project configuration, installs UI dependencies, detects the toolchain and prepares the native build environment; you can skip it if the wizard already ran a full sync. `arrange dev` starts the UI dev server in Debug mode by default, then builds and opens the Standalone window. After a CLI command finishes, it pauses so you can review the output; press Enter to return to the terminal before running the next command.

The window shows the project title and a clickable counter. Click the counter to confirm that reactive updates are working.

**3. Edit the SFA and watch it hot-reload**

With `arrange dev` still running, open `ui/src/App.sfa` in your editor. Find `projectTitle` in the script and change it to:

```ts
const projectTitle = 'My First Arrange UI'
```

Save the file and watch the title change in the open window. Then change the root `Column`'s background in the template from `Color(0xff17212e)` to `Color(0xff243447)`, save, and the background updates. You can also replace the whole file with the panel from the previous section and keep experimenting with layout, styling and click interaction. All of these UI changes take effect through hot reloading, with no C++ rebuild and no need to reopen the window.

Once the dev session is ready, stop it as prompted in the terminal with Esc or Ctrl+C, then press Enter to return to the terminal. To produce release artifacts, run this in the project root:

```sh
arrange build
```

It runs a Release build by default and collects the deliverables. The CLI prints their final location, which is the project's `artifacts/` directory by default. Existing JUCE projects can be brought in with `arrange adopt`.

## Development

Arrange is currently developed and maintained mainly by me (EARZU CHAN) on my own. Contributions are welcome; please get in touch first. Development documentation lives in [this directory](docs/) (in Chinese).

## Closing Remarks

- Contact: contact@earzuchan.me

### About This Project

- Arrange was initially inspired in part by [React-JUCE](https://github.com/JoshMarler/react-juce), but takes an entirely different route: it uses the more modern QuickJS-NG engine (instead of Duktape), its own measurement and layout system (instead of Yoga), and it does not map the component tree onto `juce::Component`s. Arrange owns layout, drawing and interaction itself.
- Open source under the [MIT](LICENSE) license. If you find it helpful, please give it a Star. Arrange borrows ideas from Compose, contains code derived from Vue.js, and depends on projects such as JUCE and QuickJS-NG; see the [Third-Party Notices (CHINESE ONLY)](THIRD_PARTY_NOTICES.md). If you build commercial products with Arrange, pay particular attention to JUCE's licensing requirements.
- AI assistance such as OpenAI GPT, Anthropic Claude were used during development.
- Arrange is still being refined, with the aim of giving you a usable, dependable experience, but no guarantee of production readiness is made. Please evaluate for yourself whether to use it in production; you do so at your own risk.