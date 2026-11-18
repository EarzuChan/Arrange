# 024 Dist 脚本表示与字节码工具链

状态：已决策。更新 ADR 023 的 Dist 默认值和清单契约。

- ZIP 与字节码分别作为默认载体和脚本表示。目录与 JS 分别可显式选择。四种组合使用相同的包落点和逻辑模块名。
- 发布清单升级到 format 2。字节码标记实际 QuickJS 构建身份，脚本文件与逻辑名独立，资源名维持原语义。Framework 0.12 与 CLI 1.4 按兼容码 3 一次切换，升级后重建产物。
- Vite 输出 ESM 构建输入，CLI 完成 Dist 装配。字节码编译器与宿主链接同一 CMake qjs 目标。字节码 UI-only 可构建所选 flavor 的编译器；完整构建在 Vite 与 CMake 工作完成后汇合。
- Dist 在同一解析和执行链路选择 JS 编译或字节码反序列化。Live/HMR 使用 Vite JS 快照。打包阶段验证已构建 UI、native 身份和交付载体，沿用事务替换。

长期契约见 [工具链与 App 发布包](../arch/14-工具链与App发布包.md) 与 [Arrange CLI 与工程模式](../arch/31-ArrangeCLI与工程模式.md)。
