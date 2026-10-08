# 定位

本文定义 UI App bundle、开发服务器、资源处理与运行时 `ui/` 包规则。Arrange 工程级 CLI、create / adopt / sync / build / package 与 artifacts 规则见 [Arrange CLI 与工程模式](31-ArrangeCLI与工程模式.md)。

# UI 源码项目

UI 源码项目位于标准 Arrange 工程下的 `ui/` 目录：

```txt
ui/
  package.json
  src/main.ts
  src/App.sfa
```

该 `ui/` “算”是 Node.js 项目。工程根目录不是 Node.js 项目。

# 开发模式

用户在工程根执行：

```bash
arrange dev
```

Arrange CLI 调用 UI 工具链，提供 Arrange SFA 编译入口、HMR adapter、host target diagnostics 与默认 dev server 设置：

```txt
host: 127.0.0.1
port: 9178
strictPort: true
```

# 构建模式

用户在工程根执行：

```bash
arrange build
```

UI 源码项目内部构建输出或仍叫 `dist/`，这是 UI 项目内部概念。Arrange 的最终交付物由 CLI 整理到工程根目录下的 `artifacts/`。

# 运行时 ui 目录

运行期可加载的 UI 产物包目录默认叫 `ui/`：

```txt
ui/
  app.js
  chunks/...
  assets/...
  其他入口文件（可选）
```

`useDist()` 默认寻找名为 `ui/` 的 UI 产物包，用户也可以显式提供别的目录名。

# 结合到 C++ 发布包

Arrange CLI 的 package phase 负责把 UI 产物与 native 产物整理到 `artifacts/`。C++ 发布版按约定优先找 `ui/`；若用户显式在代码中申明了别的目录，则按显式目录加载。

Windows 是可执行文件同级目录下的 `ui/`；macOS 和各类 bundle 则是资源目录里的 `ui/`。Debug 是否启用 live，不改变 dist 的打包位置与发现方式。

# 诊断

Arrange 工具链应在开发期诊断：

- 无法 lowering 到 Arrange host target 的节点、属性或语法。
- 未知 Arrange host arrangable。
- prop / modifier / event / resource / reactive slot schema 不匹配。
- Arrange runtime / native protocol 版本不匹配。

# 资源处理

Vite 侧资源引用优先使用 ESM import；`public/` 里的文件在构建时原样复制到输出包根，在 Live 时由开发服务提供。Vite 负责将导入解析成资源地址或内联图片；C++ 获取层消费解析结果，不单独维护第二套资源图。

资源来源跟随实际加载成功的 App source，而非构建 flavor。Live 注入当前已配置开发服务的资源获取器；Dist 注入 UI package 文件获取器。两者共享后台加载、图片与 SVG 解码、不可变结果、Painter 状态与生命周期处理，资源读取不进入音频线程或绘制阶段。共享 worker 由 JUCE GUI 关闭流程在消息线程销毁前收回，SVG 消息锁响应任务取消；Mac 每个任务独立释放平台临时对象，运行时退休和应用退出都属于加载生命周期。

资源引用形态：

```ts
import logo from "./assets/logo.png"
import play from "./assets/play.svg"
```

Painter 获取层接收以下资源引用：

- Vite 产出的资源字符串。
- 显式 `{ path: string }` 资源引用。
- 指向 UI package 内资源的字符串路径。
- Vite 产出的 SVG、PNG、JPEG、GIF `data:` 地址；Live 与 Dist 共用内联解码，不发起网络请求。默认字节预算为 16 MiB。

Dist 字符串路径规则：

- `"/logo.png"` 表示 UI package root 下的资源 URL：去掉 URL 查询和片段后，单次解码百分号编码，再检查文件边界。Vite 非内联资源中编码后的空格、中文与百分号由此对应实际文件名。
- `"assets/logo.png"` 表示 UI package root 下的字面相对文件路径；不将其百分号或问号重新解释为 URL 编码或查询。
- 禁止绝对文件系统路径。
- 禁止 `../` 逃逸 UI package。
- 禁止隐式相对当前工作目录查找。
- 不加载网络资源；Live 网络读取是显式选择开发服务后的独立来源能力。
- 默认不读取用户数据目录、开发者自定义缓存目录或任意外部路径；这类能力必须进入单独的数据、缓存与权限设计。

Live 地址规则：

- 相对地址和以 `/` 开头的地址由已配置开发服务解析；包括 Vite 导出的源码资源地址及查询参数。
- 绝对 HTTP(S) 地址必须属于同一服务 origin；跨 origin、文件系统地址、路径逃逸和重定向均拒绝。
- 网络获取在后台执行，检查 HTTP 状态、超时与内容大小；默认字节预算为 16 MiB，每次 HTTP 执行的连接与读取总时限最多 5 秒（可选择更短），不包含后台线程池排队。错误保留资源地址和原因，进入同一 Painter 失败与源码诊断路径。
- Live 资源不从 Dist 补读，避免热更新模块与旧包内图片混用；源回退到 Dist 后改用包内获取器。
- ESM 资源更新沿 Vite 模块热更新重新获取；配置的 `publicDir` 内文件增删修改发出标准完整重载，监听随该服务关闭而清理。不开第二套资源图或持久网络缓存。已退休请求的迟到结果不得发布到新一代 Painter。

位图与 SVG 均由 Painter 获取层解析。Image/Icon 只消费 Painter；固有尺寸、绘制、失败与退休规则见 [内建 Arrangable](12-内建Arrangable.md)。

资源缺失、格式不支持、解码失败必须通过 `Log.e` 记录，并进入必要错误屏。不得用硬编码占位图标或静默空绘制冒充加载成功。

# 插件数据、缓存与用户文件

插件数据、缓存与用户文件属于独立能力域，不属于 UI package 资源加载语义。Arrange 对路径、权限、线程与多实例行为必须有明确模型后才提供官方 API。

原则：

- UI 资源只从 UI package 内受控读取。
- 不假设进程当前工作目录是插件目录、工程目录或用户数据目录。
- 不向插件 bundle、VST3 bundle、安装目录或 UI package 写入业务数据、缓存或日志。
- 不在 audio thread 做文件 I/O。
- 不在 `paint()`、pointer move、layout / paint 等高频关键路径中依赖同步文件 I/O。
- VST3 / AU / AAX 宿主下，窗口、路径、权限、生命周期和多实例行为均按插件宿主现实处理。
- diagnostics file sink 只作为显式 native 配置存在，调用方必须保证线程和频率安全。
- 插件状态、preset、宿主保存/恢复状态走音频插件自身的 host state / processor state 机制。

官方文件管理能力必须单独设计，至少明确：

- user data、cache、log、temp 的目录边界。
- Standalone / VST3 / AU / AAX 的差异。
- 多实例隔离与并发写入。
- cache 可清理、user data 不可随意清理。
- 权限、隐私、迁移、诊断导出与错误处理。
