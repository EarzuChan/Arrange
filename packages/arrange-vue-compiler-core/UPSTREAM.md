# 上游来源与维护边界

基线：vuejs/core 3.5.34，原始目录 `packages/compiler-core`。本包源码已针对 Arrange 爆改，不再与上游逐文件同步。

本包负责模板解析、表达式和结构转换、持久值绑定生成。生产语义以 [Arrange Vue 宿主目标](../../docs/arch/27-ArrangeVue宿主目标.md) 为准。

上游更新按具体缺陷或功能选择性移植；评估动态依赖、结构和值域归属、宿主 schema、作用域退休与帧调度后再合入。不得整包覆盖 Arrange 改动。

行为测试归属仓库 `tests/runtime/`，原生集成归属 `cpp_tests/`；真实 SFC fixture 与主 Demo 复用组件，进入 QuickJS 和 PublishedFrame。上游原样测试副本不作为 Arrange 的行为契约。每次移植修改相应持久行为测试，遵循 [测试策略](../../docs/arch/22-测试策略.md)。
