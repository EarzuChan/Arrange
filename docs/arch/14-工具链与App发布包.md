# 开发模式

UI 源码项目通常长这样：

```txt
ui-src/
  package.json
  vite.config.ts
  src/main.ts
  src/App.vue
```

`vite.config.ts`：

```ts
import arrange from "@arrange/vite-plugin"

export default {
  plugins: [arrange()],
}
```

`@arrange/vite-plugin` 提供 Arrange Vue SFC 编译入口、HMR adapter、host target diagnostics 与默认 dev server 设置：

```
server: {
  host: "127.0.0.1",
  port: 9178,
  strictPort: true,
}
```

用户启动：

```bash
pnpm dev
```

# 构建模式

用户执行：

```bash
pnpm build
```

源码项目构建输出仍叫 `dist/`，这是 Vite/源码项目内部概念。

Arrange 约定：把 `dist/` 作为一个可加载的 UI 产物包目录。默认运行时目录是 `ui/`，但用户也可以显式加载别的产物包目录。

# 运行时 ui 目录

```txt
ui/
  app.js
  chunks/...
  assets/...
  其他入口文件（可选）
```

# 结合到 C++ 发布包

默认提供一种发布规则：

- 构建二进制时一并把 `dist/` 复制到约定运行时目录

C++ 发布版按约定优先找 `ui/`；若用户显式给了别的目录，则按显式目录加载。无需 manifest。
Windows 是可执行文件同级目录下的 `ui/`；macOS 和各类 bundle 则是资源目录里的 `ui/`。Debug 是否启用 live，不改变 dist 的打包位置与发现方式。

# 诊断

Vite 插件应在开发期诊断：

- 无法 lowering 到 Arrange host target 的节点、属性或语法。
- 未知 Arrange host component。
- prop / modifier / event / resource / reactive slot schema 不匹配。
- Arrange runtime / native protocol 版本不匹配。

# 资源处理

Vite 侧资源引用走 ESM import 或 `new URL(..., import.meta.url)`；`public/` 里的文件原样复制到输出包根。C++ 只负责按已解析资源引用读取 UI package 内文件，不单独维护第二套资源图。

资源引用形态：

```ts
import logo from "./assets/logo.png"
const play = new URL("./assets/play.svg", import.meta.url)
```

Arrange runtime 可接收：

- Vite 产出的资源字符串。
- Arrange Vite 插件规范化出的 `ResourceRef` 对象。
- 指向 UI package 内资源的字符串路径。

字符串路径规则：

- `"/logo.png"` 表示 UI package root 下的 `logo.png`。
- `"assets/logo.png"` 表示 UI package root 下的相对路径。
- 禁止绝对文件系统路径。
- 禁止 `../` 逃逸 UI package。
- 禁止隐式相对当前工作目录查找。
- 默认不加载远程网络资源；未来若支持 remote resource，必须单独设计缓存、错误、权限和诊断。
- 默认不读取用户数据目录、开发者自定义缓存目录或任意外部路径；这类能力未设定好，之后我们（开发组）必会进入单独的数据、缓存与权限设计。

`Image` 主要加载位图资源，具体解码格式由平台图片解码能力决定。`Icon` 加载 Arrange Icon resource schema 定义的 SVG 子集，具体规则见 [内建组件](12-内建组件.md)。

资源缺失、格式不支持、解码失败必须产生 `resource` 类别的 `DiagnosticEvent`，并进入日志、recent event ring 与必要错误屏。不得用硬编码占位图标或静默空绘制冒充加载成功。

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




