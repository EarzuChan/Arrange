# 定位

Demo 是 Arrange 的实际测试场地，也是面向用户的主样板，不是玩具式样板。

它承担：

- authoring 体验实验室。
- 框架整体链路验收场。
- 真实宿主测试插件。
- 文档截图与 smoke artifact 来源。

Demo 数量宁少勿多。目前是在优先维护一个长期伴生的主 Demo，而不再搞多个散装示例。

Demo 必须走真实消费路径：通过 Arrange CLI 编排工程，TS 侧通过 `@arrange/framework`，C++ 侧通过 `Arrange::framework`。除非确有必要，不另建其它伪 Demo。

# 工程形态

```txt
demo/
  arrange.project.yaml
  arrange.local.yaml      # 本机，不提交
  .arrange/               # CLI 本机记录，不提交
  plugin-src/
    ...
  ui-src/
    ...
    package.json
    package-lock.json
    tsconfig.json
    dist/                 # 构建产物，不提交
  artifacts/              # CLI 交付物，不提交
```

`ui-src/` 是独立 npm UI 项目；发布运行时的 `ui/` 是 CLI 在产品旁或 bundle 内整理的构建产物目录。

Demo 保留 `ui-src/`、`plugin-src/` 目录，通过共享配置声明实际路径。它是由 Arrange CLI 管理的普通工程；位于 Arrange Git 仓库内不改变工程主权。标准命令、配置职责与交付规则见 [Arrange CLI 与工程模式](31-ArrangeCLI与工程模式.md)，运行步骤见 [Demo 说明](../../demo/README.md)。

## 消费与版本

UI 使用独立安装的 `@arrange/framework` npm 包和公开 exports，自带 manifest、npm 锁文件、Vite 配置与 SFA 类型检查入口，不继承根 TS paths 或 workspace 链接。UI 构建输出为自身 `dist/`，由 CLI 调用工程脚本及整理交付物。

Native 使用 `FetchContent_Declare(arrange)`、`FetchContent_MakeAvailable(arrange)` 并链接 `Arrange::framework`。默认使用公开 Arrange Git 仓库和固定 Framework 版本 tag，仓库地址、tag 与 npm 依赖版本由 CLI CONFIG 管理。禁止从 Demo `add_subdirectory` Arrange 根或直接引用内部 TS/C++ 源文件构建产品。

Demo 产品版本独立于框架版本。`arrange.project.yaml` 的 Framework 版本是 Demo 选择消费的版本；升级经 CLI 配置与同步完成。根版本同步、安装与内部包检查不写 Demo manifest，不要求 Demo 已安装或已构建。

## 本机来源与独立移动

验证尚未公开发布的 Framework 时，先按[本机发包流程](../proj/5：具体开发的额外约束.md#本机发包)把包发到本机 Verdaccio、在本仓库打 dev tag，再在不提交的 `arrange.local.yaml` 中覆盖获取来源：

```yaml
framework:
  nodeRegistryUrl: http://localhost:4873
  cmakeFetchContentUrl: ..
```

共享配置的 `framework.version` 改为对应的 dev 版本后 sync。UI 与 Native 都经正式包消费路径获取同一版本，覆盖规则见[配置分工](31-ArrangeCLI与工程模式.md#配置分工)。

只需临时验证未提交的 Native 源码时，也可改用标准 CMake 覆盖 `native.cmakeDefinitions.FETCHCONTENT_SOURCE_DIR_ARRANGE`（本机 Arrange 源码根绝对路径）。它只覆盖 Native，UI 仍消费实际安装的 npm 包，且不能与本机仓库覆盖并用。

共享配置不使用相对 Git 仓库地址：CLI 的来源预检、缓存获取和 CMake configure 有不同工作目录，共享的相对地址不能保证各阶段含义一致。相对路径只允许出现在本机覆盖中，由 CLI 按工程根解析。不会因工程恰好在仓库内就自动选择父目录源码；来源身份必须明确。

Demo 可以复制到 Arrange 仓库外；源码、素材、共享配置和 UI 锁文件随工程移动，依赖、本机配置、构建树与产物重新准备。清除本机覆盖并 sync 后按共享声明消费公开来源，不能静默回退到仓库内部路径。版本是否已发布属于当期验收事实，记录在 M2 工作区，不以本机包验收冒充公网获取通过。

## 框架仓库边界

Demo 不属于根 Node workspace，也不是根 CMake 子工程。框架仓库不替 Demo 安装、构建、启动、复制 UI 或打包；这些工作只走正式 `arrange` 命令。不保留 Demo 私有启动脚本、根构建任务或 UI copy hook。Native 不释放或重建控制台，由 CLI 独占终端、子进程输出和交互生命周期。

框架测试只读取或借用 Demo 的 SFA、TS、PNG、SVG 等源码与素材，复制到测试自己的隔离目录后，用测试依赖编译运行。夹具输出置于对应 native 测试构建树或临时测试目录，不读取 Demo 的 `node_modules/`、`dist/`、`.arrange/`、`artifacts/`。借用主画廊行为的测试保持源码复用，不另维护同语义页面。

# 插件形态

Demo 插件目标：

- Standalone。
- VST3 Effect。

选择 Effect 而非 Instrument，是为了减少 MIDI 处理干扰，更适合快速真实宿主测试。

不实际处理音频：参数仅用于 Demo 测试，不会对实际声效产生影响。

# 具体实现

Demo 的复杂度随里程碑增长。早期可以很小，但必须能反馈 Arrange 的开发体验和运行效果。

Demo 可以逐渐复杂；模板必须干净、克制、适合新项目复制。

# 里程碑贯穿规则

每个里程碑都必须更新 Demo：

- 新能力进入 Demo。
- Demo smoke 覆盖主链路。
- Demo 暴露 authoring 体验问题，并反向修正 API。
- Demo 的工程形态应保持用户样板，不依赖仓库内部特供消费路径。

真实链路集成测试直接复用主 Demo 的 ShowcaseGallery、AnimationGallery 等 SFA。测试外壳只负责注入动作、观察资源和采样，不维护另一套页面行为；图形体验验收仍由主人运行 Standalone 或插件完成，见 [测试策略](22-测试策略.md)。
