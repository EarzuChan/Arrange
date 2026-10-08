# Framework m.2.4 原生本地发布候选验收

结论：Mac arm64 Debug 原生源码交付候选验收通过。

- 临时 Git 候选：`v0.0.0-m.2.4`，提交 `b10ef8d00fdf8e5ce7ff3998d8028b8e5c5b48e1`
- 从当前工作区完整复制源码（包含未跟踪新增模块），共 677 文件；manifest、临时 Git 仓库与真正 FetchContent 检出逐项 SHA-256 一致
- 独立 CMake 消费者仅链接公开 `Arrange::framework`，编译与运行断言 Framework `0.0.0-m.2.4`、协议 `5` 通过
- 原生树从 FetchContent 的 Git 检出构建；JUCE 8.0.12 / QuickJS-NG v0.14.0 为独立干净检出，没有 Arrange 原仓库源码 override
- Git 检出执行自己的 frozen pnpm 安装，Vite 8.0.16 / source-map-js 1.2.2 / esbuild 0.28.2 / Sass immutable 5.1.8；SFA 原生夹具用最终补丁依赖重新构建
- 完整 CTest：**17/17**，22.32 秒
- 独立 npm 生产 UI 产物直接执行：QuickJS / JUCE 两项烟雾测试及合法 Modifier、非法数组、未知 Modifier、诊断与非法级别等五项模式：**7/7**
- 最终生产 UI SHA-256：`ab9af52a4043c3bb30414567c06fa7163f05480dbb2a22b325441914b8a40d2d`
- 必要测试修复：两处 mutation index cast 对齐 uint32_t；两个 Mac console harness 改用官方 JUCE 应用启动宏，保留 SVG 异步加载、Owner 消息和全部断言；clang-format 22 与 diff 检查通过

最后只更新 workspace 的依赖声明和锁文件，重新 frozen 安装、生成 SFA 夹具并全量重跑 17 项 CTest。289 个原生/CMake/Framework 生产源文件与当前工作区逐 bytes 一致；生产 UI SHA 不变，先前 7 项直接烟雾测试结果继续适用，其中两个生产 UI 运行时测试也包含在最终全量 CTest 中。

原仓库没有创建 commit 或 tag；本轮没有修改 SDK 生产代码、正式 Demo 或执行发布。临时候选验证不能替代真实远端 native tag 获取验证，Windows 未在本机运行。

总证据为 [native-release-verification.json](native-release-verification.json)，源码文件清单为 [source-manifest.json](source-manifest.json)。完整测试为 [sdk-ctest-security-final.log](sdk-ctest-security-final.log)，直接生产包执行记录为 [production-native-smokes.json](production-native-smokes.json)。前述窄化错误、Mac console 消息循环超时与一次重复 stop 失败日志均保留为中间诊断。
