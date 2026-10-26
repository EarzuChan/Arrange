# CMake definitions 清理与 Bundle ID 验收

日期：2026-10-12。Windows x64 实机验收完成。长期规则见 [CLI 与工程模式](../../../arch/31-ArrangeCLI与工程模式.md#产品标识显示名与图标)，资源占用仍遵守[进程生命周期](../../../arch/36-ArrangeCLI资源占用与进程生命周期.md)。

## 修复内容

- `CmakeDefinitions` 独立处理 definition 校验、归属键记录与 configure 参数差异，`CmakeService` 负责调用编排。全部 CLI `-D` 纳入唯一归属记录，用户删除选项、切换源码覆盖或取消后重试均可清除残值。
- 移除旧源码路由记录的实现和常量，不保留旧格式读取；无归属记录的已有缓存树干净重建，正常重试保持增量树与共享源码。
- 创建向导、工程创建、缺省 Bundle ID 和 Windows JUCE 默认标识共用生成函数；移除旧 native target 默认规则和重复前缀。显式 Bundle ID 保留原值。
- 当前 definitions 归属记录替代[上一轮源码缓存验收](20261012-用户目录与源码缓存验收.md)中的源码路由记录，该报告保留当时的验收事实。

## 自动化

CLI typecheck、build、修改文件格式检查、`git diff --check` 均通过。完整 CLI 测试 356 项：350 通过、0 失败、6 跳过；仓库 Node 测试 219 项全部通过。

新测试通过真实 MSVC/CMake/Ninja 配置与构建，验证用户选项删除恢复工程默认、CLI 默认恢复、精确清理不影响未归属相邻键、连续 configure 失败后恢复、输出触发真实进程取消后恢复、自动源码与手工目录切换、无归属旧树重建、损坏记录拒绝执行。普通重试保留构建树中的哨兵文件；重建则移除它。Bundle ID 测试验证创建与缺省结果一致、中文厂商使用 vendorCode、显式值保持、target 不参与生成；CONFIG 测试更新了缺省身份随工程名变化的预期。

测试设置 `TERM=xterm-256color`，并将 Visual Studio CMake 加入 PATH；UI 回归使用已有 xterm 无头终端夹具。初次沿用工具默认 `TERM=dumb` 时，Windows 输出 ASCII 图形，既有 Unicode 断言失败；在对应终端环境重跑后全部通过，未修改 UI 生产实现。

本机证据：仓库 `.arrange/verification/definitions-cli-tests.txt`、`definitions-workspace-tests.txt`；GeldBlacqMan 值核验为 `definitions-geld-verify-overridden.json`、`definitions-geld-verify-clean.json`。

## GeldBlacqMan

真实工程 `E:/c_misc/tmp/arGround/GeldBlacqMan`，通过全局 `arrange` 的真实 PTY 入口执行：

- native CONFIG 同步成功，显式 macOS Bundle ID 保留，Windows 默认值改用统一生成规则。
- native SETUP 成功，首次将缺少新版归属记录的 debug/release 构建树重建，共享源码保留。
- 临时设置 `ARRANGE_DEFINITION_REMOVAL_PROBE=was-set`、`CMAKE_COLOR_DIAGNOSTICS=OFF`、`CMAKE_OBJECT_PATH_MAX=240`，SETUP 后两棵树的缓存和归属记录均确认生效。
- 按原文字节恢复 local YAML，再次 SETUP 后两棵树的 probe 均消失，颜色恢复 ON，对象路径上限恢复 200，准备凭据存在。共享源码条目集合未变化。
- `arrange build --native-only --flavor debug --product standalone --no-pack` 成功，native 构建凭据为 completed。
- `arrange sync --scan --setup --native` 全部 Idle；测试结束无遗留 operation 记录。

全局 CLI 为指向当前工作区 `cli` 的现有 Junction，已构建新版 dist，并通过全局入口执行上述验证；`arrange --version` 为 1.0.0。

## 验证边界

本轮没有 macOS 或 Windows arm64 实机测试。macOS 的真实 CMake 测试入口已具备工具链发现与相同断言，待对应设备运行。删除 definition 后恢复的是 CMake 的实际默认行为，不承诺撤销工程 CMake 脚本自定义的其它副作用。
