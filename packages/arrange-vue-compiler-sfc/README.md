# @vue/compiler-sfc

> 很润的。用于编译 Vue 单文件组件（SFC）的底层工具库

**注意：自 3.2.13+ 版本起，此包已作为主包 `vue` 的依赖项内置，可以通过 `vue/compiler-sfc` 直接访问。这意味着你不再需要显式安装此包并确保其版本与 `vue` 保持一致，直接使用主包的 `vue/compiler-sfc` 深度导入即可。**

如果你正在为打包工具或模块系统编写插件/转换器，用于将 Vue 单文件组件（SFC）编译为 JavaScript，则可以使用此包中提供的底层工具。它被应用于 [vue-loader](https://github.com/vuejs/vue-loader) 和 [@vitejs/plugin-vue](https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue) 中。

## API

考虑到在构建系统中集成 Vue SFC 时的各种因素，该 API 被刻意设计得较为底层：

- **针对 script、template 和 styles 分别进行热模块替换（HMR）**
    - template（模板）更新不应重置组件状态
    - style（样式）更新应在不重新渲染组件的情况下执行。主人批注：并没有什么样式了。

- **利用构建工具自身的插件系统处理预处理器**。例如：`<style lang="scss">` 应该由对应的 webpack loader 处理。

- **在某些情况下，SFC 中各个块（block）的转换器并不共享同一个执行上下文**。例如，当与 `thread-loader` 或其他多进程/并行配置一起使用时，`vue-loader` 中的 template 子 loader 可能无法访问完整的 SFC 及其描述符（descriptor）。

其总体思路是生成一个**门面模块（facade module）**，用于导入组件的各个独立块。这里的巧妙之处在于，**该模块会使用不同的查询字符串（query strings）导入自身**，以便构建系统可以将每个请求作为“虚拟”模块进行处理：

```
                                  +-------------------------+
                                  |                         |
                                  |     script transform    |
                           +----->+        (脚本转换)       |
                           |      +-------------------------+
                           |
+--------------------+     |      +-------------------------+
|                    |     |      |                         |
|  facade transform  +----------->+    template transform   |
|    (门面转换)      |     |      |       (模板转换)        |
+--------------------+     |      +-------------------------+
                           |
                           |      +-------------------------+
                           +----->+                         |
                                  | no more style transform |
                                  |     (再无样式转换)      |
                                  +-------------------------+
```

生成的门面模块代码大致如下：

```js
// 主脚本
import script from '/project/foo.vue?vue&type=script'
// 模板编译为渲染函数
import { render } from '/project/foo.vue?vue&type=template&id=xxxxxx'
// 样式。主人批注：再没有什么样式了
import '/project/foo.vue?vue&type=style&index=0&id=xxxxxx'

// 将渲染函数挂载到 script
script.render = render

// 挂载额外的元数据
// 其中一些应当仅在开发环境中存在
script.__file = 'example.vue'
script.__scopeId = 'xxxxxx'

// 特定工具的额外 HMR 处理代码
// 使用全局的 __VUE_HMR_API__

export default script
```

### 总体工作流程

1. **门面转换（Facade transform）：** 使用 `parse` API 将源代码解析为描述符（descriptor），并基于该描述符生成上述门面模块代码；

2. **脚本转换（Script transform）：** 使用 `compileScript` 处理脚本。这一步会处理诸如 `<script setup>` 和 CSS 变量注入等特性。或者，这也可以直接在门面模块中完成（将代码内联而不是通过 import 导入），但这需要将 `export default` 重写为一个临时变量（为此提供了便捷的 `rewriteDefault` API），以便将额外的配置项附加到导出的对象上。

3. **模板转换（Template transform）：** 使用 `compileTemplate` 将原始模板编译为渲染函数代码。

4. **样式转换（Style transform）：** 使用 `compileStyle` 编译原始 CSS，以处理 `<style scoped>`、`<style module>` 和 CSS 变量注入。主人批注：再没有什么样式了。

这些 API 所需的配置项均可以通过查询字符串（query string）传递。

有关详细的 API 参考和选项，请查看源码中的类型定义。关于这些 API 的实际用法，不建议再参考 [@vitejs/plugin-vue](https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue) 或 [vue-loader](https://github.com/vuejs/vue-loader/tree/next)，而是要自力更生、艰苦奋斗。
