# 第三方声明

Arrange 本身以 [MIT 协议](LICENSE)开源。本文件列出了 Arrange 所包含的源自第三方的源代码，以及 Arrange 在构建并链接时所使用的第三方项目，并附其许可证。

## Vue.js (vuejs/core)

- 源码：https://github.com/vuejs/core
- 基于版本：3.5.34
- 许可证：MIT

Arrange 的部分代码取自 Vue.js。上游代码已被深度修改、特化与重组，不再沿用 Vue 的包结构；上游代码与 Arrange 自身的代码在同一文件内交错混合。涉及的范围大致如下：

| Arrange 位置                       | 取自                   |
|----------------------------------|----------------------|
| `packages/reactivity`            | `@vue/reactivity`    |
| `packages/shared`                | `@vue/shared`        |
| `packages/compiler/src/core`     | `@vue/compiler-core` |
| `packages/compiler/src/sfa`      | `@vue/compiler-sfc`  |
| `packages/framework/src/runtime` | `@vue/runtime-core`  |

```text
The MIT License (MIT)

Copyright (c) 2018-present, Yuxi (Evan) You and Vue contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## QuickJS-NG

- 源码：https://github.com/quickjs-ng/quickjs
- 使用版本：v0.14.0
- 许可证：MIT

QuickJS-NG 被编译进 Arrange 的原生侧，因此也会进入使用 Arrange 构建的应用程序和插件中。

```text
The MIT License (MIT)

Copyright (c) 2017-2026 Fabrice Bellard
Copyright (c) 2017-2024 Charlie Gordon
Copyright (c) 2023-2026 Ben Noordhuis
Copyright (c) 2023-2026 Saúl Ibarra Corretgé

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## JUCE

- 源码：https://github.com/juce-framework/JUCE
- 使用版本：8.0.12
- 许可证：[AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html) 与商业 [JUCE 8 许可证](https://juce.com/legal/juce-8-licence/)双授权

Arrange 不包含 JUCE 源代码，我们是在构建时获取 JUCE 并与之链接。注意：**您使用 Arrange 构建的任何产品同时也是在使用 JUCE**，因此您必须遵守 AGPLv3 协议或您所持有的 JUCE 商业许可证。JUCE 本身还捆绑了其他具有各自许可证的依赖项；完整列表请参阅 JUCE 的 `LICENSE.md`。

## 致谢

以下项目启发了 Arrange 的设计。Arrange 不包含它们的代码，因此无需附带许可声明；在此列出以表谢意。

- [Jetpack Compose](https://developer.android.com/compose)：布局模型、Modifier 链以及整体设计理念。我本人是严厉的 Compose 使用者和追随者。
- [React-JUCE](https://github.com/JoshMarler/react-juce)：使用 JavaScript 引擎驱动 JUCE UI 的启蒙者。

## 其他依赖项

Arrange 各个包的 npm 依赖项（例如 `@babel/parser` 和 `magic-string`）会由您的包管理器作为独立的包进行安装，并附带它们各自的许可证文件。