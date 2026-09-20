# Arrange SFA 编译器

将 `.sfa` 的模板和唯一 TS setup 脚本编译为 Arrangable 定义，处理参数声明、内容入口、类型依赖和源码映射。内部包路径暂沿用 `@arrange/vue-compiler-sfc`，包收敛属于 M2.4 第二趴。

应用构建通过 `@arrange/framework/vite` 接入，模板与脚本契约见 [Arrange Vue 宿主目标](../../docs/arch/27-ArrangeVue宿主目标.md)。不提供 Vue 双脚本、`.vue` 加载或浏览器渲染兼容路线。
