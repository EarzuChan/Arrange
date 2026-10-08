# Arrange CLI 与工程模式

本文是 Arrange CLI 的长期事实源，定义工程形态、配置分工、命令职责、平台边界与交付物整理规则。文件托管与 CONFIG/SETUP 状态机见 [Arrange CLI 托管与同步模型](32-ArrangeCLI托管与同步模型.md)。

## 地位

Arrange CLI 是唯一官方工程编排入口，命令名为 `arrange`，由 `@arrange/cli` 提供。它调用包管理器、Vite、CMake 与 JUCE，使用这些工具的真实结果判断工程能否开发、构建和打包。

```txt
@arrange/cli -> arrange 命令
@arrange/framework -> UI authoring 与运行时入口
Arrange::framework -> native 唯一公开 target
```

`@arrange/framework`、`@arrange/vite-plugin` 和其它内部包不提供独立 CLI。

## 内部职责与依赖

| 目录 | 职责 |
|---|---|
| `command/` | 参数解析、命令注册与调用服务 |
| `project/` | 工程初始化、ProjectState、共享与本机配置存储、工程检查入口 |
| `managed/` | File/Cluster/Region、ManagedItem 的通用机制与类型；见[托管模型](32-ArrangeCLI托管与同步模型.md#定义state-与拓扑) |
| `config/` | 当前支持的配置定义注册，统一物理文件入口与逻辑托管项 |
| `sync/` | CONFIG 与 SETUP 的独立编排 |
| `framework/` | registry metadata、Framework 版本与 CLI 兼容性 |
| `node-js/` | UI 包管理器、依赖准备与 UI 构建 |
| `cmake/` | CMake 文件定义、configure/build、File API 模型与准备检查 |
| `building/` | build/dev 的工程编排 |
| `packing/` | 真实产物定位、完整 bundle 整理、UI 资源、打包提交与 Mac 签名检查 |
| `platform/` | 工具探测、平台环境、统一进程执行与开发进程监管 |
| `wizard/` | 领域交互接口的终端实现与命令向导 |
| `util/` | 独立的文件、事务、路径和数据辅助工具 |

CLI 不使用全局服务容器。`Entry.ts` 检查正式运行环境，管理信号与退出；`CliApplication.ts` 通过显式参数装配本次调用的服务并注册命令，不自行启动。业务模块不得反向依赖入口或装配模块。

共享服务由共同上层创建，通过构造函数注入；函数形式的命令和向导通过参数接收。内部专属部件由所属类创建，需要的共享依赖继续传入。无状态部件可以分别创建；需要替换或管理生命周期的外部能力也可注入，不以消费者数量作为唯一判据。

默认直接使用具体类，不为单一实现机械抽取接口。业务流程的询问、报告和提示通过小型领域交互接口注入，终端实现由上层创建；业务服务不实例化 Wizard，也不判断 TTY。依赖必须显式提供，不回退到全局实例，也不通过懒加载规避循环依赖。构造过程只组装对象，不启动网络请求、外部进程或交互。工程根、State、报告和快照通过操作参数或局部变量传递。测试创建自己的服务和交互替代实例，不修改私有成员、全局服务或类原型。

所有外部进程经过 `Executor`；`DevSupervisor` 在完成、失败和取消时释放子进程与监听器。平台差异集中于平台服务及 bundle/signing 适配，命令不直接拼接平台工具链。

### 正式入口与自动化

正式 `arrange` 入口只允许 Windows/macOS，且标准输入、标准输出都必须为 TTY；包括 help/version 在内的所有调用都先经过这一检查。拒绝发生在服务装配、工程读取、网络请求和外部工具调用之前。平台选择明确区分 `win32` 与 `darwin`，其它平台报告不支持，不回退到 Mac 实现。

不以环境变量猜测测试环境，也不提供命令行绕过。管道、输出重定向及普通 CI 进程不能直接调用正式入口。测试与自动化显式调用应用装配入口或业务服务，并提供预定交互策略；未安排的询问应明确失败。真实工具链自动化仍遵循 Windows/macOS 的平台限制。正式入口本身通过终端或 PTY 验证。

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

工程根不是 Node workspace，不要求根 `package.json`。`ui/` 是 TypeScript UI 子项目，`native/` 是 CMake/JUCE 子项目，`artifacts/` 是 CLI 整理的交付物目录。目录名可配置。`.arrange/` 保存本机准备、构建与事务记录，不提交到 Git；具体职责见[托管模型](32-ArrangeCLI托管与同步模型.md#arrange-与写入失败)。

既有工程命令在当前目录寻找 `arrange.project.yaml`，不向上推断工程根，不提供 `--cwd`、`--root` 或隐式 workspace 规则。create/adopt 可以在当前目录建立工程根或项目名子目录；后续命令在生成的工程根执行。

## 配置分工

`arrange.project.yaml` 是提交到 Git 的共享事实，描述项目元数据、具体 Framework 版本、产品、目录与托管项。`arrange.local.yaml` 是本机特异配置，不提交到 Git。

共享配置中的 `native.target` 必须明确指定 JUCE 插件共享代码根 target；它不从产品显示名称或 CMake 正文反推。CLI 使用 JUCE 的 `<target>_Standalone` 与 `<target>_VST3` 格式 target，通过 CMake 模型核验类型、依赖和真实产物路径。`ui.outputDirectory` 可指定 UI 构建目录，默认 `dist`，必须是 UI 子项目内的独立产物目录。

本机配置记录 Node、包管理器、CMake、编译器和必要时的 Ninja 路径及版本。`native` 部分记录 `generator`、`architecture: x64|arm64`、Windows 的 `developerCommand`、Mac 的 `developerDirectory`，以及可选 `cmakeDefinitions`。自定义 CMake definitions 不得覆盖 CLI 管理的配置、生成器、编译器或架构选项。

运行时统一通过 [ProjectState](32-ArrangeCLI托管与同步模型.md#定义state-与拓扑) 使用配置与工程根。CONFIG 维护文件中的项目事实；SETUP 使用真实工具链准备可执行的工程，不以写一份 local YAML 代替依赖安装与 CMake configure。

## 命令

```bash
arrange create [--registry <url>] [--fetch-content <url>]
arrange adopt  [--registry <url>] [--fetch-content <url>]
arrange sync   [--scan] [--config | --setup] [--ui | --native]
arrange dev    [--ui-only | --native-only] [--flavor debug|release]
arrange build  [--flavor debug|release] [--ui-only | --native-only]
                [--no-package] [--product standalone|vst3 ...] [--clean]
arrange package [--flavor debug|release] [--product standalone|vst3 ...] [--clean]
```

范围参数互斥；省略范围表示同时处理 UI 与 native。product 只能选择工程已启用的产品，省略时使用共享配置的 products。dev 默认 `debug`；build/package 默认 `release`。

### create 与 adopt

create 交互收集并确认配置，通过共用的 File/Cluster/Region 定义生成工程文件，同时生成最小 UI/native 源文件、Vite/SFA 类型检查入口及 `.gitignore`。初始化先展示计划，避免覆盖既有文件；写入失败保留已写内容与事务记录，明确报告继续处理方式。

adopt 支持新建、复制或原位引用 UI/native 子项目。已有 native 由用户提供准确 target；已有 UI 可读取 JSON 展示现状。接入文本托管使用共用 Wrapper/Marker 交互，不解析正文反推项目配置。复制排除 `.git`、`.arrange`、`node_modules` 和本机配置；未托管内容保留。

两者保存工程后可选择立即同步。取消后续准备不会撤销已经完成的工程初始化。未启用 ManagedItem 的初始生成及后续忽略规则见[托管模型](32-ArrangeCLI托管与同步模型.md)。

### sync

完整 sync 先完成 CONFIG，成功后重新加载 State，再运行 SETUP；失败或放弃不进入后续部分。`--config` 或 `--setup` 可限制部分。`--scan` 只观察、报告，不 Resolve、不 Apply；存在阻塞或待执行的准备动作时，所选 SETUP 返回非零状态。两部分各自的 LSRA 与扫描分类见[托管模型](32-ArrangeCLI托管与同步模型.md)。

SETUP 使用实际工具和准备记录判断工程能否执行后续命令；检查矩阵、交互、安装与 configure 的具体规则见[托管与同步模型](32-ArrangeCLI托管与同步模型.md)。

### dev

检查配置、工具链及所选范围的准备状态。默认 `debug` 启动 UI dev server 和 Standalone；`--ui-only` 在任何 flavor 下都只启动 UI 服务。native dev 要求工程启用 standalone；每次启动前都执行正式 Standalone 增量构建，再使用与 package 共用的定位器，避免将同名旧二进制误当作最新代码。

完整 Debug dev 不要求已有 UI dist，也不先构建 UI 或打包；UI 服务就绪后启动构建树中的 Standalone，由 Framework 按实际 Live 源获取模块与图片、图标资源。完整 `release` dev 先构建 UI，再打包 Standalone 并启动整理后的二进制。`--native-only` 在两种 flavor 下都使用现有 UI dist 打包 Standalone 后启动，缺少 UI 产物时提示先执行 UI build。这两种方式都不由 CLI 启动 UI dev server。

CLI 不覆盖 native 程序的 App source 选择。生成的 Debug 模板仍采用 Live 优先、Dist 回退；native-only 可以连接已经运行的约定服务，无 Live 时读取打包资源。source API 的行为以 [App 入口](02-App入口.md#app-source-api)为准。

资源来源跟随 Framework 实际选中的 Live 或 Dist 源，CLI 不复制资源来模拟 Live，也不维护第二套资源图。图片与图标的路径、加载和热更新边界见[资源契约](14-工具链与App发布包.md#资源处理)。

Debug 完整模式在 UI 服务就绪后才启动依赖它的 native 进程。监管程序拒绝被占用的开发地址、处理启动失败与提前退出，并在进程结束或信号到来时停止关联子进程。Ctrl+C 是正常结束。dev 不静默修改托管配置或执行依赖安装。

### build

按 flavor、范围和 products 构建真实产物。UI 调用所选包管理器的 build 脚本并检查 `app.js`；native configure 后按所选格式 targets 构建。完整构建默认继续 package；单范围构建不 package，`--no-package` 可关闭完整构建的整理。

CLI 在构建开始、成功、失败时更新本机构建记录，包含项目/Framework 版本、UI 输出或 native target/configuration/platform/architecture/products。记录用于识别 CLI 已知的失败或明显版本失配，不构建全仓源码指纹系统。

`--clean` 只清理本次所选范围：UI 为独立产物目录，native 为所选平台、架构与 flavor 的 CMake 构建树内清理。不得清理源文件、依赖目录或其它 flavor/platform 的产物。

### package

只整理已有的 UI/native 构建产物，不 install、不 configure、不 build。它核验 native 准备模型、配置、架构、格式目标与完整 bundle，要求 UI dist 包含普通文件 `app.js`，复制整个 UI 目录。

已有 CLI 构建记录必须为 `completed`，且版本、输出位置、目标与所选产品等事实匹配；缺少记录允许整理手工构建的产物。缺少记录不代表已证明源码或二进制版本一致；打包清单保留可取得的版本与文件摘要。

## 版本与工具链

工程使用具体 Framework 版本，不使用 `latest`。sync、dev、build、package 均拒绝不兼容组合。兼容检查的来源选择和编排统一归 FrameworkService，registry 获取与兼容规则分别由底层组件负责。dev/build/package 优先读取本机 UI 已安装 Framework 的 `package.json`，核验确切版本与 `arrange.cliCompatibility`；版本完全匹配时无需在线 registry，缺失或版本不同时才查询 registry，JSON 损坏或匹配版本的兼容契约无效时明确失败。CONFIG/SETUP 及工程创建、接入时的版本选择仍查询 registry 元数据。依赖安装完成后另核验实际安装包，不能以远程候选通过检查代替安装结果。

项目版本保留完整 SemVer，包括 prerelease/build metadata；传入 JUCE 插件 `VERSION` 时使用其中的 `major.minor.patch` 数字部分，以满足 JUCE 的版本计算。交付目录和打包清单仍记录完整项目版本。

支持 Windows/MSVC 与 macOS/Xcode clang 的 `x64`、`arm64` 工程。Node 至少 24，CMake 至少 3.24；包管理器使用工程所选 npm/pnpm。默认 native generator 为 Ninja；本机配置可选择可用生成器。Windows 调用已验证的 Visual Studio Developer 环境，并核对实际 MSVC 目标架构；Mac 使用选定 Developer Directory 的 Xcode clang。Linux 和跨平台交叉编译不属于当前契约。

原生构建尊重 `CMAKE_BUILD_PARALLEL_LEVEL`，由 CMake 解释其值；未设置时使用工具链默认并行构建。

build/dev 发现准备缺失或过期时报告并提示 `arrange sync --setup`，不隐式改写 local 配置。SETUP 才负责发现、交互确认、安装依赖和配置构建树。package 读取已存在的 CMake 模型，不重新探测或准备工具链；Mac 签名检查与修复仍使用系统 `codesign`。

## 交付物布局与提交

默认布局为 `artifacts/<flavor>/<version?>/<platform>-<arch>/<product>/`，platform 使用 `macos` 或 `windows`。产物显示名称可以不同于 target，实际位置由 CMake File API 的 artifacts 确定，再按平台规则提升到完整产品目录；不要求工程导出 JUCE 内部属性或新增强制 CMake 胶水。

| 产品 | 复制范围 | UI 位置 |
|---|---|---|
| Windows Standalone | `.exe` 与 CMake 依赖图中可定位的运行 DLL | 与 `.exe` 同目录的 `ui/` |
| Mac Standalone | 完整 `.app` | `<app>/Contents/Resources/ui/` |
| Windows/Mac VST3 | 完整 `.vst3`，保留 bundle 内既有资源与元信息 | `<plugin>/Contents/Resources/ui/` |

Windows VST3 的二进制目录按架构核验为 `Contents/x86_64-win` 或 `Contents/arm64-win`；Mac 产品核验 `Contents/MacOS` 和 `Info.plist`。只复制 bundle 内现成的依赖，不尝试改写任意外部 Mac dylib 搜索路径。

所有产物在同文件系统临时目录中整理、核验后再替换。UI 总是整体更新以去除旧资源；`--clean` 仅重建本次 flavor/version/platform/product 的所选产品目录，其它输出保留。不带 clean 时保留所选目录的额外文件，但仍替换当前产品和 UI。提交采用备份和逆序回退；失败不得先删除旧交付物，回退失败保留并报告备份位置。路径重叠、包外/失效符号链接或交付目录中的符号链接别名须在提交前拒绝。

产品和交付目录分别生成轻量 `arrange-package.json`，记录项目/Framework 版本、平台架构、相对路径、可用构建记录和入口/二进制摘要。

### Mac 签名边界

复制 UI 后先验证 bundle 签名。有效签名保留；unsigned 或 ad-hoc bundle 可按本地运行需要 ad-hoc 重签并重新验证。已有 ad-hoc 标识、entitlements、flags/runtime 元信息应保留，无法安全保留时失败。

已有身份签名失效时明确报错，不静默降级为 ad-hoc。CLI 当前交付范围是可运行的产物整理；Developer ID/证书选择、notarization、installer、系统安装目录写入和发布流程需要另行设计及授权。

## 事实源关系

- 用户可见 CLI、工程目录、命令、平台和交付整理：本文。
- File/Cluster/Region、ManagedItem、CONFIG/SETUP 状态机与 `.arrange/`：[托管与同步模型](32-ArrangeCLI托管与同步模型.md)。
- 本期实现状态与验收证据：[M2.2 第三期工作区](../proj/m2/2/第三期M2.2的工作.md)。
- 本轮工程能力与交付边界的决策原因：[ADR 016](../adr/016-M2.2%20CLI工程准备与交付整理.md)。
