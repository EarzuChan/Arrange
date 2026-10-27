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

| 目录 | 职责与依赖 |
|---|---|
| `terminal/` | 通用 TUI：唯一终端所有权、输入、结构化历史、提示控件、任务呈现、只读控制台、布局、嵌套滚动、整帧绘制与退出拍扁；只依赖 util 与第三方终端解析能力 |
| `business/` | 命令定义、参数、向导、报告文案、资源计划和交互过程；使用 terminal 的语义接口与 feature 服务，把功能进展转换为呈现事实 |
| `feature/` | 实际功能：project、managed、config、sync、framework、nodejs、cmake、building、packing、source、user、storage、transaction、operation、asset、platform；不依赖或直接使用 terminal、business |
| `util/` | 独立路径、文件、字节解码、文本宽度与数据工具；不反向导入其它层 |
| `Entry.ts / CliApplication.ts / CliMetadata.ts` | 入口、显式装配和长期常量；业务与服务不反向导入入口与装配 |

三层经业务侧连接：`business → terminal`、`business → feature`；terminal 与 feature 彼此不导入、不直接调用。各层可使用 util。文件事务具有持久恢复语义，归 feature/transaction；命令资源编排归 business。目录使用单数名词。

CLI 不使用全局服务容器。`Entry.ts` 检查正式运行环境，管理信号与退出；`CliApplication.ts` 通过显式参数装配本次调用的服务并注册命令，不自行启动。业务模块不得反向依赖入口或装配模块。

共享服务由共同上层创建，通过构造函数注入；函数形式的命令和向导通过参数接收。内部专属部件由所属类创建，需要的共享依赖继续传入。无状态部件可以分别创建；需要替换或管理生命周期的外部能力也可注入，不以消费者数量作为唯一判据。

默认直接使用具体类，不为单一实现机械抽取接口。业务流程的询问、报告和提示通过小型领域交互接口注入，终端实现由上层创建；业务服务不实例化 Wizard，也不判断 TTY。依赖必须显式提供，不回退到全局实例，也不通过懒加载规避循环依赖。构造过程只组装对象，不启动网络请求、外部进程或交互。工程根、State、报告和快照通过操作参数或局部变量传递。测试创建自己的服务和交互替代实例，不修改私有成员、全局服务或类原型。

命令资源与异常退出保护见 [CLI 资源占用与进程生命周期](36-ArrangeCLI资源占用与进程生命周期.md)。所有外部进程经过 `Executor`；`DevSupervisor` 在完成、失败和取消时释放子进程与监听器。平台差异集中于平台服务及 bundle/signing 适配，命令不直接拼接平台工具链。

命令与向导只接收 business 的 CommandInterface（报告、语义提示、功能进展执行器）。Entry 创建 TerminalSession，并用 business/WorkPresenter 把 terminal 的任务呈现接口适配为 feature/operation/Work 的功能进展契约；领域服务只依赖自己层内的契约。terminal 不接收 ProcessSpec、Executor、工程日志路径策略或领域服务实例。业务不能取得终端流、输入事件、坐标、视口、ANSI 模式或文档句柄。

命令 action 返回本次结果码，未返回表示成功；ApplicationCommand 收集包括嵌套命令在内的结果，等待资源收尾后交给入口。业务不读取或修改宿主 process.exitCode，入口在会话恢复完成后统一设置进程退出码；取消和异常由会话出口处理。不同应用实例和连续调用不共享上一次结果。

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
  assets/                 # 可选，与 UI/native 并列的共享源资源
  artifacts/
```

工程根不是 Node workspace，不要求根 `package.json`。`ui/` 是 TypeScript UI 子项目，`native/` 是 CMake/JUCE 子项目，`artifacts/` 是 CLI 整理的交付物目录。目录名可配置。`.arrange/` 保存本机准备、构建与事务记录，不提交到 Git；具体职责见[托管模型](32-ArrangeCLI托管与同步模型.md#arrange-与写入失败)。

既有工程命令在当前目录寻找 `arrange.project.yaml`，不向上推断工程根，不提供 `--cwd`、`--root` 或隐式 workspace 规则。create/adopt 可以在当前目录建立工程根或项目名子目录；后续命令在生成的工程根执行。

## 配置分工

`arrange.project.yaml` 是提交到 Git 的共享事实，描述项目元数据、具体 Framework 版本、产品、目录与托管项。`arrange.local.yaml` 是本机特异配置，不提交到 Git。

共享配置中的 `native.target` 必须明确指定 JUCE 插件共享代码根 target；它不从产品显示名称或 CMake 正文反推。CLI 使用 JUCE 的 `<target>_Standalone` 与 `<target>_VST3` 格式 target，通过 CMake 模型核验类型、依赖和真实产物路径。`ui.outputDirectory` 可指定 UI 构建目录，默认 `dist`，必须是 UI 子项目内的独立产物目录。

本机配置可用 `framework.nodeRegistryUrl`、`framework.cmakeFetchContentUrl` 覆盖共享配置中的 Framework 获取来源，用于本机 registry、本机仓库等开发场景：

```yaml
framework:
  nodeRegistryUrl: http://localhost:4873
  cmakeFetchContentUrl: ..
```

版本仍只由共享配置声明，本机只决定从哪里获取。生效来源依次取本机覆盖、共享配置、官方默认，由 CLI 统一解析（`framework/FrameworkOrigin.ts`）：sync 将生效 registry 写入托管的 UI `.npmrc`，版本核验、源码预检和源码缓存使用生效仓库；共享的 CMakeLists `GIT_REPOSITORY` 仍只写共享配置，本机仓库经源码缓存以 `FETCHCONTENT_SOURCE_DIR_ARRANGE` 交给 CMake。本机仓库可写相对工程根的路径，CLI 先解析为绝对路径再用于各阶段。仓库地址或版本未托管、或同时设置了 `FETCHCONTENT_SOURCE_DIR_ARRANGE` 时，本机仓库覆盖无法确定生效，SETUP 报告 Fatal。UI `.npmrc` 因含本机来源而不提交，create 写入对应忽略规则。删除本机覆盖并 sync 即回到共享来源。

本机配置记录 Node、包管理器、CMake、编译器和必要时的 Ninja 路径及版本。`native` 部分记录 `generator`、`architecture: x64|arm64`、Windows 的 `developerCommand`、Mac 的 `developerDirectory`，以及可选的 `cmakeDefinitions` 和构建树根目录 `buildRoot`（见同篇“版本与工具链”一节的构建树位置说明）。自定义 CMake definitions 不得覆盖 CLI 管理的配置、生成器、编译器或架构选项。

CLI 的全部 `-D` 参数由当前配置、工具链与默认规则统一生成。每个构建树中的 `definitions.json` 仅保存 CLI 可能写入过的键，不保存配置值；自动源码覆盖也纳入这份记录。configure 前以精确 `-UKEY` 清除已删除的键，再以 `-DKEY=value` 写入当前值；仍有 CLI 默认值的键直接恢复该默认值。CMake 自身创建或用户手工写入的其它缓存键不属于 CLI 的日常清理范围。

启动 CMake 前原子保存新旧键的并集，整个 configure 验证成功后收缩为当前键集合，最后发布准备凭据。失败、取消或异常退出不会丢失待清理键；这些写入遵守[构建树资源占用](36-ArrangeCLI资源占用与进程生命周期.md)。已有 CMakeCache 却缺少归属记录时重建该构建树，避免继承无法追溯的旧值；共享依赖源码缓存保留。归属记录损坏时明确拒绝，不猜测或迁移旧格式。

运行时统一通过 [ProjectState](32-ArrangeCLI托管与同步模型.md#定义state-与拓扑) 使用配置与工程根。CONFIG 维护文件中的项目事实；SETUP 使用真实工具链准备可执行的工程，不以写一份 local YAML 代替依赖安装与 CMake configure。

### 产品标识、显示名与图标

以下字段位于共享 YAML 的 `project` 下：

```yaml
project:
  name: SuperSynth
  displayName: Super Synth
  bundleId: com.acme.supersynth
  icon: assets/icon.png
```

`bundleId` 仅在 macOS 生效，Windows 不设置 AUMID。创建向导、工程创建和缺省字段读取共用 `generateDefaultBundleId`：生成 `com.<制造商段>.<产品段>`，制造商段取 `vendorName` 的 ASCII 字母数字并转小写，结果为空则取小写 `vendorCode`；产品段取 `project.name` 的 ASCII 字母数字并转小写，不使用 native target。create 跳过时将生成值保存到 YAML，后续重命名不改变已保存身份；其它工程省略时按当前字段生成，需要固定身份时显式填写。显式值保留原样。Windows 的 JUCE 构建参数也使用同一函数生成默认标识，忽略仅用于 macOS 的显式值。

`displayName` 用于产品文件名、产品显示元数据、默认窗口名称和插件向 DAW 报告的名称。create 跳过时将当时的 `project.name` 保存为显示名；既有 YAML 省略时回退到 `project.name`。允许中文和空格，拒绝跨平台文件名禁用字符、控制字符、Windows 保留名以及末尾点或空格。工程机器名、CMake target、源码名称仍由原字段管理。生成产物为 `<displayName>.app`、`<displayName>.exe`、`<displayName>.vst3`；产物位置仍读取 CMake 模型，不拼接显示名猜测路径。

VST3 名称以 UTF-16 class info 向宿主报告。JUCE 8.0.12 的 VST3 命令对 shell 特殊字符和 Unicode 名称处理不完整；根工程在构建树内应用受版本检查的 CMake 兼容修正，不改写依赖检出。JUCE 对应定义变化时 configure 必须明确失败并要求审查修正。

`icon` 是相对**工程根目录**的 PNG 路径；`assets/` 与 `ui/`、`native/` 并列，`assets/icon.png` 不是 UI 子项目内的资源。create 可选择外部 PNG，将其复制到工程根的 `assets/icon.png` 后保存相对路径。源文件必须是静态正方形 PNG，边长至少 256，推荐 1024，支持透明度；损坏、缺失或不合格时明确失败。省略时新工程使用系统默认图标，adopt 不借此接管或覆盖已有手工图标配置。

图片解码、透明度正确的缩放和格式转换均由 CLI 的 Node 侧完成，生成物置于本机构建树，不要求用户安装图片转换工具，也不调用 JUCE 的图标转换程序。只生成不超过源图尺寸的规格。macOS 的 `.app`、`.vst3` 使用 Resources 中的 ICNS 和 plist 引用；Windows EXE 将 ICO 编译进资源，VST3 使用 `Plugin.ico`、`desktop.ini` 及对应 shell 属性。DAW 内图标呈现由宿主决定。

CONFIG 维护构建接入配置；SETUP/configure 在构建前准备派生图标，build/dev 使用同一链路，pack 仅整理并核验既有产物。准备与构建记录包含显示名、适用平台的 Bundle ID 和图标源内容摘要。同路径 PNG 修改、配置删除或显示名变化会使旧记录过期；仅重新 configure 不代表旧二进制已经包含新资源。

## 命令

```bash
arrange create [--registry <url>] [--fetch-content <url>]
arrange adopt  [--registry <url>] [--fetch-content <url>]
arrange sync   [--scan] [--config | --setup] [--ui | --native]
arrange dev    [--ui-only | --native-only] [--flavor debug|release]
arrange build  [--flavor debug|release] [--ui-only | --native-only]
                [--no-pack] [--product standalone|vst3 ...] [--clean]
arrange pack [--flavor debug|release] [--product standalone|vst3 ...] [--clean]
```

范围参数互斥；省略范围表示同时处理 UI 与 native。product 只能选择工程已启用的产品，省略时使用共享配置的 products。dev 默认 `debug`；build/pack 默认 `release`。

### create 与 adopt

create 交互收集并确认配置，通过共用的 File/Cluster/Region 定义生成工程文件，同时生成最小 UI/native 源文件、Vite/SFA 类型检查入口及 `.gitignore`。初始化先展示计划，避免覆盖既有文件；写入失败保留已写内容与事务记录，明确报告继续处理方式。

adopt 支持新建、复制或原位引用 UI/native 子项目。已有 native 由用户提供准确 target；已有 UI 可读取 JSON 展示现状，并在 UI 目录没有 `tsconfig.json` 时给出不阻塞的提示（缺它不影响构建，只影响编辑器提示与 SFA 类型检查；不替用户生成已有工程的文件）。接入文本托管使用共用 Wrapper/Marker 交互，不解析正文反推项目配置。复制排除 `.git`、`.arrange`、`node_modules` 和本机配置；未托管内容保留。

两者保存工程后可选择立即同步。取消后续准备不会撤销已经完成的工程初始化。未启用 ManagedItem 的初始生成及后续忽略规则见[托管模型](32-ArrangeCLI托管与同步模型.md)。

### sync

完整 sync 先完成 CONFIG，成功后重新加载 State，再运行 SETUP；失败或放弃不进入后续部分。`--config` 或 `--setup` 可限制部分。`--scan` 只观察、报告，不 Resolve、不 Apply；存在阻塞或待执行的准备动作时，所选 SETUP 返回非零状态。两部分各自的 LSRA 与扫描分类见[托管模型](32-ArrangeCLI托管与同步模型.md)。

SETUP 使用实际工具和准备记录判断工程能否执行后续命令；检查矩阵、交互、安装与 configure 的具体规则见[托管与同步模型](32-ArrangeCLI托管与同步模型.md)。

### dev

检查配置、工具链及所选范围的准备状态。默认 `debug` 启动 UI dev server 和 Standalone；`--ui-only` 在任何 flavor 下都只启动 UI 服务。native dev 要求工程启用 standalone；每次启动前都执行正式 Standalone 增量构建，再使用与 pack 共用的定位器，避免将同名旧二进制误当作最新代码。

完整 Debug dev 不要求已有 UI dist，也不先构建 UI 或打包；UI 服务就绪后启动构建树中的 Standalone，由 Framework 按实际 Live 源获取模块与图片、图标资源。完整 `release` dev 并行构建 UI 与 Standalone，都成功后打包 Standalone 并启动整理后的二进制。`--native-only` 在两种 flavor 下都使用现有 UI dist 打包 Standalone 后启动，缺少 UI 产物时提示先执行 UI build。这两种方式都不由 CLI 启动 UI dev server。

CLI 不覆盖 native 程序的 App source 选择。生成的 Debug 模板仍采用 Live 优先、Dist 回退；native-only 可以连接已经运行的约定服务，无 Live 时读取打包资源。source API 的行为以 [App 入口](02-App入口.md#app-source-api)为准。

资源来源跟随 Framework 实际选中的 Live 或 Dist 源，CLI 不复制资源来模拟 Live，也不维护第二套资源图。图片与图标的路径、加载和热更新边界见[资源契约](14-工具链与App发布包.md#资源处理)。

Debug 完整模式在 UI 服务就绪后才启动依赖它的 native 进程。监管程序拒绝被占用的开发地址、处理启动失败与提前退出，并在进程结束或信号到来时停止关联子进程。Native dev 还要求实际编译的 Framework 源码支持就绪回执协议；旧源码在构建前明确拒绝。正常结束的开启时机、用户停止与异常退出的区分见本节“终端输出与交互”。dev 不静默修改托管配置或执行依赖安装。

### build

按 flavor、范围和 products 构建真实产物。UI 调用所选包管理器的 build 脚本并检查 `app.js`；native configure 后按所选格式 targets 构建。完整构建时 UI 与 native 并行，任一失败时另一个跑完后一起报告，不进入 pack。完整构建默认继续 pack；单范围构建不 pack，`--no-pack` 可关闭完整构建的整理。build 结尾总是说明打包去向：打包完成时与 pack 同样列出交付目录、各产品位置、二进制大小与清单；跳过或因范围未打包时明确说明原因。

CLI 在构建开始、成功、失败时更新本机构建记录，包含项目/Framework 版本、UI 输出或 native target/configuration/platform/architecture/products。记录用于识别 CLI 已知的失败或明显版本失配，不构建全仓源码指纹系统。

`--clean` 只清理本次所选范围：UI 为独立产物目录，native 为所选平台、架构与 flavor 的 CMake 构建树内清理。不得清理源文件、依赖目录或其它 flavor/platform 的产物。

### pack

只整理已有的 UI/native 构建产物，不 install、不 configure、不 build。它核验 native 准备模型、配置、架构、格式目标与完整 bundle，要求 UI dist 包含普通文件 `app.js`，复制整个 UI 目录。

已有 CLI 构建记录必须为 `completed`，且版本、输出位置、目标与所选产品等事实匹配。显式配置了产品显示名、图标或 macOS Bundle ID 时，必须有匹配资源身份的 CLI native 构建记录，防止只更新配置便交付旧二进制；缺少记录时提示先执行 native build。未使用这些字段的既有工程继续允许整理手工构建的产物；缺少记录不代表已证明源码或二进制版本一致，打包清单保留可取得的版本与文件摘要。

## 终端输出与交互

入口创建一个 `terminal/TerminalSession`。正式命令、帮助、报告、提示结果、任务与最终状态进入同一份 SessionDocument。会话期间使用备用屏幕，ScreenRenderer 按绝对坐标整帧绘制；主缓冲区在退出时才接收 TranscriptRenderer 展开的完整历史。正式入口不提供文本显示模式切换，非 TTY 库测试通过注入驱动使用同一文档与渲染代码。

Reporter 只提供普通消息及 info／step／success／warn／error 色调，不提供 intro／outro／fail／cancelled API；文档没有 heading／result 特殊节点。消息色调只决定显示颜色，命令结果码、异常和取消信号决定会话状态。DocumentRenderer 按完整文档的位置赋予 `┌`／`└`：首条消息承接头线，结束后的末条消息承接尾线；首尾不是普通消息时补独立边界行，单行内容也保留完整首尾。中间消息与活跃问题使用连续引导线，不指定开头或结尾。屏内绘制和退出拍扁共用这套规则。dev 取消只输出取消消息，取消后没有业务收尾消息时会话补“已取消操作”，清理失败仍保留实际原因。

TerminalDriver 是唯一 stdin/stdout、raw mode、备用屏幕、鼠标与粘贴报告、resize 和信号监听持有者。InputDecoder 解析有状态 UTF-8 / VT / SGR 输入；会话内部把输入交给 PromptController 或 ViewportController。Ctrl+C 与 Escape 由会话统一取消命令，不由问题控件另走局部取消；Tab 不切入历史或只读控制台。PageUp/PageDown 回看历史，Home/End 在文本问题中编辑、无问题时回看历史。鼠标点击历史和控制台不取得焦点，也不向背后进程传入按键。

会话文档是一条线性内容流，问题和任务批次跟随其上下文滚动，通常仅末尾的问题或一批任务活跃；执行期间的等待消息归入该批次，不在其后追加新的主项。主项前统一留引导空行，短内容整体贴底；placeholder 使用灰色，多选使用空心/实心小圆。问题保留验证、默认值和类型化选项值，答案标签与业务值分离；空输入采用生成默认值时，历史答案显示该默认值而业务仍可收到空值。选择列表围绕当前项显示可用范围，不把最新问题固定为另一块屏幕面板。

历史是一份逐步定稿的交互文档，不是状态变化的追加日志。SessionDocument 的流程区块具有稳定身份，可嵌套；`replace()` 在同一位置开始新一代内容，`complete(答案)` 将整个步骤收束为结果，`complete()` 保留当前现场并结束步骤。业务只取得区块的报告、提问、任务和子区块语义接口，不取得文档节点。业务定义步骤范围和最终摘要，terminal 统一管理写入资格、绘制、输入和生命周期；feature 不依赖区块或任何 TUI 类型。

同一步骤的加载、失败与重试原位替换；失败由任务展示一次原因，业务提供重试或取消。Framework 版本准入的具体循环见下文“版本与工具链”，最终收束为版本答案；目录、子项目接入及托管项等多问题决策收束为实际配置结果。CONFIG／SETUP 的扫描、修正和重扫共用扫描步骤，旧报告与临时修正问题由下一轮取代；只读扫描、阻断及取消保留现场，真正执行的任务与控制台保留。完成语义通过类型化业务结果传递，不从文案推断。

短暂的 `status` 等待在成功后由下一项接替；失败仍保留至业务重试或收束。单任务与同名任务组只呈现一个标题，提升为主行后符号与标题之间统一留两个空格，状态和进度原位更新。区块替换必须等待任务与解析收尾；`replace()` 和 `complete(答案)` 覆盖区块内全部内容，包括预检产生的控制台，不按是否产生输出强行保留任务。候选源码获取或复用是版本决策的中间状态，进入选择题后撤下完整检查区块。实际安装、配置、构建等执行任务放在需要保留的历史区块中，以 `complete()` 保留现场，完成荧幕继续独立滚动；后续决策区块的替换不影响它们。替换或完成撤销该区块内未结束的问题输入，旧代及其所有子区块拒绝迟到写入；会话结束后冻结未收束区块。普通新交互不得越过尚未结束的子区块。

任务标题呈现状态与进度，不另外显示阶段或状态附文灰字；实际工具输出接入时才展开只读子控制台。资源竞争等待由持有当前任务的业务显式绑定为临时任务进展，资源取得、等待失败或任务收尾时清除；不作为全局消息，也不伪装成子进程输出。任务结果区分正常退出、用户请求停止、关联进程停止、命令取消和实际失败；只有实际失败的子控制台保存日志，正常停止及取消仍保留屏幕历史。每个控制台按实际内容行数显示，高度最多六行；完整边框与文本分别建模，命中范围严格取框本身（含边框），框外滚轮回到主历史。各控制台的滚动偏移独立，运行中向上回看暂停跟随、回到底部恢复跟随，顶边显示可滚方向及“·跟随中”；任务结束后移除跟随提示，底边保留“╰─已完成 / 已停止 / 失败 / 已取消”。结束后的荧幕仍在历史内独立滚动。

`@xterm/headless` 只解释子进程 ANSI、颜色、回车、光标和清屏，Arrange 管理布局、命中和历史。ConsoleBuffer 的解析宽度独立于宿主视口，内部软行归档时重新拼回原逻辑行，离屏及清屏前内容纳入同一控制台历史。解析器与可观看内容分离：执行结束等待剩余字节解析完成后释放解析器，保留文档中的荧幕内容；用户不能直接操作背后执行会话。所有正式子进程经 Executor 捕获，禁止 stdio inherit。

子控制台输出由业务适配器暂存，成功完成时默认不写日志文件；失败、取消或停止等非成功结果在结束后将完整输出保存到工程 `.arrange/logs`。没有子控制台的普通任务不生成空日志。仅文件实际写出成功后显示“已记录到 <路径>”，运行中不显示日志路径，保存失败不得覆盖业务原始错误或谎报成功。CLI 开发常记录开关只在代码内设置，默认关闭，独立于用户工程的 debug/release；开启时成功结果也在结束后保存。日志不反向驱动 UI，成功与失败的完整会话历史仍统一拍扁。

所有命令结果都停屏，用户按 Enter 退出；这包括帮助、版本、命令组缺少子命令、参数错误、非零业务结果和用户取消。默认 Ctrl+C 与 Escape 取消当前命令，等待业务资源和控制台解析器收尾，呈现“已取消”结果并返回 130。业务可在明确的可正常结束阶段开启作用域化停止能力；这时按键只向该阶段发出停止信号，不取消命令，作用域提示立即撤下，重复按键仍由该作用域消费。作用域只能由业务依据真实就绪事实开启，收尾期间不可重开。正式 dev 在依赖检查、构建、服务启动和 Standalone 窗口首帧就绪前仍使用命令取消；全部相关组件就绪后才开放正常结束。就绪后用户结束、Standalone 正常关闭均以退出码 0 收尾；UI 服务意外退出、Standalone 非零／带信号退出、就绪超时及清理失败仍作为失败并保留原因。停屏后重复 Ctrl+C、Escape 不退出或改写结果，Enter 前的按键不代替退出确认。停屏保留快照、滚动和 resize，只有 Enter 才开始恢复与拍扁。外部终止信号、终端故障与全局异常走可靠退出，不等待用户输入。驱动等待在途帧，停止输入报告，在 raw mode 下短暂丢弃迟到报告，恢复原输入状态、光标和主屏幕，等待拍扁写回调后释放监听与所有权。恢复幂等；不关闭共享系统流或调用 process.exit，不操作父 shell。退出钩子只作同步模式兜底，不替代正常异步收尾。命令、任务或开发进程已经失败时，后续资源/呈现清理再失败必须同时保留最初原因与清理原因，不以 finally 的错误覆盖最初失败。

TranscriptRenderer 从同一定稿文档展开所有保留控制台，已被替换的中间状态不再出现；按最长原行撑开框宽、保留左右边框，不按退出时终端宽度 soft-wrap，不保留滚动提示和“按 Enter”提示。首尾各留一空行，与调用命令和随后 shell 提示符分隔。错误与正常信息均在这一份 transcript 中写出，不另维护一份 stderr 历史。入口环境不支持时仍在服务装配前拒绝，并由会话出口呈现诊断。

CLI 文件大小使用十进制 B、KB、MB、GB 等单位自动显示，最多一位小数并省略末尾零；统计不完整时保留“至少”提示。扫描报告、配置范围和工具链规则见对应业务章节。

终端输入和绘制契约的自动化与双平台验收规则见[测试策略](22-测试策略.md#原则)。自动化模拟器只证明绘制、布局、解析和路由契约；Windows ConPTY 及 macOS Terminal/iTerm 的真实操作由对应平台实测并由主人完成最终体验验收。
## 版本与工具链

工程使用具体 Framework 版本，不使用 `latest`。sync、dev、build、pack 均拒绝不兼容组合。兼容检查的来源选择和编排统一归 FrameworkService，registry 获取与兼容规则分别由底层组件负责。sync（CONFIG 与 SETUP）、dev、build、pack 都优先读取本机 UI 已安装 Framework 的 `package.json`，核验确切版本与 `arrange.cliCompatibility`；版本完全匹配时无需在线 registry，缺失或版本不同时才查询 registry，JSON 损坏或匹配版本的兼容契约无效时明确失败。工程创建、接入时的版本选择仍查询 registry 元数据。依赖安装完成后另核验实际安装包，不能以远程候选通过检查代替安装结果。

create/adopt 的列表、自定义输入及已有依赖建议共用 FrameworkService 版本准入：registry 返回确切版本的 metadata，且 `arrange.cliCompatibility` 为有效正整数并与 CLI 相等，再解析所选 Git 仓库的 `v<版本号>` tag 到确切 commit，复用源码缓存核验该源码的版本声明、CLI 兼容码、有效内部协议码及原生依赖清单。列表 metadata 已包含的确切版本不重复请求单版本接口；自定义及列表外的已有依赖建议先读取单版本 metadata，再复用同一源码验证。`LATEST` 不代表兼容，缺契约、契约不符或其它确定不可用的版本禁选，网络等暂时无法验证的版本另记原因且同样禁选。不允许跳过验证或构造虚假兼容信息，只有已验证结果可交给后续业务；结果包含版本、registry、源码仓库和 commit。

CLI 业务将版本选择组织为一个循环：读取列表后，以有限并发验证本次展示的全部候选，等待在途验证收尾后才展示版本题，不遍历 registry 的全部历史版本；已有依赖建议合入候选并优先定位，不提前另问是否采用。读取失败可重试或取消；部分候选暂时无法验证时可仅重试这些项、查看现有结果或取消，保留成功及确定拒绝结果。版本题提供自定义输入、失败项重试和显式刷新；刷新重新读取并验证候选，读取失败不清空已有集合。自定义验证后回同一列表并定位该项，同版本去重，失败项留原因且不可选。选中已验证版本后再问是否采用，“否”返回列表并保留当前选择，不重复联网验证，“是”才进入下一道问题。任一取消遵守统一取消停屏规则，未通过或未确认不得生成初始化请求或写工程。验证仅准备候选的 Arrange 源码，不安装 UI、JUCE 或 QuickJS-NG 依赖；源码生命周期见[用户级源码缓存](35-Arrange用户目录与源码缓存.md#共享依赖源码)。

registry 没有给出答案（连接失败、超时）与 registry 明确给出否定答案是两类结果：前者无法判定兼容性，报告为 `framework-unverifiable`，信息带 registry 地址与真实原因（如 `ECONNREFUSED`）以及“本机没有可用于离线验证的已安装版本”；后者（版本不存在、契约不兼容）是确定的结论，仍报告为 `framework-incompatible`。因此网络不通时，已安装匹配版本的工程仍可以重试 sync。

SETUP 在需要配置原生构建树时，于安装 UI 依赖之前预检 Arrange 原生源码：完整用户级缓存存在时直接通过；缺失时用 `git ls-remote --tags` 确认 git 可用、仓库可达和 `v<Framework 版本>` tag 存在。该检查仅适用于仓库地址与版本均由 CLI 托管、且没有显式本地源码覆盖的工程。缺失源码在 APPLY 的任务中获取；SCAN 不创建缓存或锁。目录、版本锁定、复用与失败恢复规则见 [Arrange 用户目录与依赖源码缓存](35-Arrange用户目录与源码缓存.md)。

项目版本保留完整 SemVer，包括 prerelease/build metadata；传入 JUCE 插件 `VERSION` 时使用其中的 `major.minor.patch` 数字部分，以满足 JUCE 的版本计算。交付目录和打包清单仍记录完整项目版本。

支持 Windows/MSVC 的 `x64` 工程，以及 macOS/Xcode clang 的 `x64`、`arm64` 工程。Windows arm64、Linux 和跨平台交叉编译不属于当前支持契约。Node 至少 24，CMake 至少 3.24；包管理器使用工程所选 npm/pnpm。默认 native generator 为 Ninja；本机配置可选择可用生成器。Windows 调用已验证的 Visual Studio Developer 环境，并核对实际 MSVC 目标架构；Mac 使用选定 Developer Directory 的 Xcode clang。

原生构建尊重 `CMAKE_BUILD_PARALLEL_LEVEL`，由 CMake 解释其值；未设置时使用工具链默认并行构建。

工具定位：Windows 上无扩展名的命令只按 `PATHEXT` 顺序解析，不选同目录下无扩展名的 sh 垫片（npm、pnpm 的安装目录里 `pnpm` 与 `pnpm.cmd` 并存，前者不能执行），并返回磁盘上的真实文件名；`.cmd`、`.bat` 由 Executor 经 `cmd` 执行。MSVC 验证实际运行 `cl.exe`，从横幅首行取版本号与目标架构记号；横幅随系统语言本地化（中文版是“用于 x64 的 … 编译器 19.50.35728 版”），所以解析只依赖与语言无关的数字版本和架构记号，不依赖其中的词，架构另与 Developer 环境的 `VSCMD_ARG_TGT_ARCH` 核对。

构建树在 Windows 与 macOS 上统一归属用户级 `~/.arrange/builds`，按工程、平台、架构与配置隔离；`native.buildRoot` 仍可显式覆盖。目录所有权与根目录覆盖见 [Arrange 用户目录与依赖源码缓存](35-Arrange用户目录与源码缓存.md)。`artifacts/` 仍在工程内。

Windows 的 `cl`、`link`、`rc` 有完整路径长度限制，configure 前继续检查构建目录长度。使用共享或显式外部 JUCE 源码时采用外部源码预算，并默认传入 `CMAKE_OBJECT_PATH_MAX=200`，让 CMake 缩短过长对象路径；用户显式设置时尊重其值。超限时提示在本机配置中指定更短的构建根，不能认为系统开启长路径选项就足够。


build/dev 发现准备缺失或过期时报告并提示 `arrange sync --setup`，不隐式改写 local 配置。SETUP 才负责发现、交互确认、安装依赖和配置构建树。pack 读取已存在的 CMake 模型，不重新探测或准备工具链；Mac 签名检查与修复仍使用系统 `codesign`。

## 交付物布局与提交

默认布局为 `artifacts/<flavor>/<version?>/<platform>-<arch>/<product>/`，platform 使用 `macos` 或 `windows`。产物显示名称可以不同于 target，实际位置由 CMake File API 的 artifacts 确定，再按平台规则提升到完整产品目录；不要求工程导出 JUCE 内部属性或新增强制 CMake 胶水。

| 产品 | 复制范围 | UI 位置 |
|---|---|---|
| Windows Standalone | `.exe` 与 CMake 依赖图中可定位的运行 DLL | 与 `.exe` 同目录的 `ui/` |
| Mac Standalone | 完整 `.app` | `<app>/Contents/Resources/ui/` |
| Windows/Mac VST3 | 完整 `.vst3`，保留 bundle 内既有资源与元信息 | `<plugin>/Contents/Resources/ui/` |

Windows x64 VST3 的二进制目录核验为 `Contents/x86_64-win`；Mac 产品核验 `Contents/MacOS` 和 `Info.plist`。只复制 bundle 内现成的依赖，不尝试改写任意外部 Mac dylib 搜索路径。

所有产物在同文件系统临时目录中整理、核验后再替换。UI 总是整体更新以去除旧资源；`--clean` 仅重建本次 flavor/version/platform/product 的所选产品目录，其它输出保留。不带 clean 时保留所选目录的额外文件，但仍替换当前产品和 UI。显示名改变时，依据上次产品清单识别并替换 CLI 原有入口；未被清单确认归属的其它产品或用户文件保留。提交采用备份和逆序回退；失败不得先删除旧交付物，回退失败保留并报告备份位置。全部替换落位即为提交点：之后旧备份或暂存因仍被占用（宿主加载着旧插件、资源管理器打开着目录）删不掉，只作为遗留在报告中列出，不回退已生效的新交付；下次打包清理未被未完成事务引用的遗留暂存。替换前旧产物即被占用时，报告占用并保持旧交付不变。路径重叠、包外/失效符号链接或交付目录中的符号链接别名须在提交前拒绝。

产品和交付目录分别生成轻量 `arrange-package.json`，记录项目/Framework 版本、平台架构、相对路径、可用构建记录和入口/二进制摘要。产品清单的 `ownedEntries` 明确本次生成的顶层入口，clean 仅按有效清单移除本平台、本架构的受管入口，保留用户额外文件；旧清单缺少归属入口时拒绝猜测删除。打包从暂存开始保留持久事务，提交与回退共用[事务恢复](32-ArrangeCLI托管与同步模型.md#持久事务与独立恢复)。

### Mac 签名边界

复制 UI 后先验证 bundle 签名。有效签名保留；unsigned 或 ad-hoc bundle 可按本地运行需要 ad-hoc 重签并重新验证。已有 ad-hoc 标识、entitlements、flags/runtime 元信息应保留，无法安全保留时失败。

已有身份签名失效时明确报错，不静默降级为 ad-hoc。CLI 当前交付范围是可运行的产物整理；Developer ID/证书选择、notarization、installer、系统安装目录写入和发布流程需要另行设计及授权。

## 事实源关系

- 用户可见 CLI、工程目录、命令、平台和交付整理：本文。
- File/Cluster/Region、ManagedItem、CONFIG/SETUP 状态机与 `.arrange/`：[托管与同步模型](32-ArrangeCLI托管与同步模型.md)。
- 本期实现状态与验收证据：[M2.2 第三期工作区](../proj/m2：已完成/2：初步完成，Win测中，待收尾/M2.2的最后工作中.md)。
- 本轮工程能力与交付边界的决策原因：[ADR 016](../adr/016-M2.2%20CLI工程准备与交付整理.md)。

## 工程与用户级维护命令

`clean` 默认清当前工程 UI 输出与本平台当前架构 Debug/Release 构建树；`--ui-only`、`--native-only`、`--artifacts-only` 互斥，`--artifacts` 将受管交付物加入默认范围，`--flavor debug|release` 只限制 native。默认保留交付物、依赖、源码、日志和恢复材料。所有修改命令先展示计划确认，`--scan` 只查看，不能绕过路径核验或资源占用。

`storage inspect` 查看登记与受管资源；`storage clean` 选择孤儿构建、无引用依赖源码及无人使用的获取临时内容；`storage repair <条目ID>` 按确切 commit 修复；`recover [事务ID]` 与 `storage recover [事务ID]` 分别处理工程与用户级未完成事务。目录规则见[用户目录](35-Arrange用户目录与源码缓存.md)，恢复见[托管模型](32-ArrangeCLI托管与同步模型.md)，互斥见[资源协议](36-ArrangeCLI资源占用与进程生命周期.md)。

维护参数：`clean [--ui-only|--native-only|--artifacts-only] [--artifacts] [--flavor debug|release] [--scan]`。单范围与 --artifacts 不混用，--flavor 不用于 UI/交付物单范围。storage clean/repair 与两个 recover 入口均接受 --scan；无事务 ID 时只列记录，有 ID 时展示目标、冲突和实际可用动作。没有 --force 或另一个 prune 别名。源码格式与旧记录边界见用户目录母文档。
