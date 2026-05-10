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
import vue from "@vitejs/plugin-vue"
import arrange from "@arrange/vite-plugin"

export default {
  plugins: [vue(), arrange()],
}
```

我们的 `@arrange/vite-plugin` 默认会设置：

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

Arrange 约定：把 `dist/` 作为一个可加载的 UI 产物包目录。默认加载约定目录 `ui/`，但用户也可以显式加载别的产物包目录。

# 运行时 ui 目录

```txt
ui/
  app.js
  chunks/...
  assets/...
  其他入口文件（可选）
```

# 结合到 C++ 发布包

默认提供两种方式：

- 手动同步 `dist/` 到约定产物包目录
- 可选同步工具或脚本自动复制

C++ 发布版按约定优先找 `ui/`；若用户显式给了别的目录，则按显式目录加载。无需 manifest。

# 诊断

Vite 插件应在开发期诊断：

- HTML / DOM 标签。
- `class` / `style`。
- SFC `<style>`。
- 未知内建组件名。
- Arrange runtime / native protocol 版本不匹配。

# 资源处理

Vite 侧资源引用走 ESM import 或 `new URL(..., import.meta.url)`；`public/` 里的文件原样复制到输出包根。C++ 只负责入口包加载，不单独解析资源图。
