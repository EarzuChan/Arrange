# CLI 产品元数据验收

本轮为 `project.displayName`、`project.icon` 与 macOS `project.bundleId` 的收尾验收。代码改动留在当前工作区；Windows 实机验证尚未进行。

## 结论

- CLI 221 项测试通过；Node 24.19 与 Node 26.5 均通过。根测试 213 项通过；CLI/root 类型检查、构建、格式与版本校验通过。
- 使用独立干净 JUCE 8.0.12、QuickJS-NG v0.14.0 checkout，在 macOS arm64 完成含空格工程路径的 create、UI 安装/build、Standalone 与 VST3 Debug/Release build/package。
- Release 产品经过显示名重命名、同路径图标替换、删除与恢复四轮 native rebuild/package。检查了 Info.plist、Bundle ID、图标资源、UI 文件、arm64 架构和 codesign；过期 native 产品被拒绝打包。最终 Release `package --clean` 完成。
- 最终 Release `.app` 经 macOS Workspace/Finder 启动：系统应用名、Bundle ID 和窗口标题符合配置；实际点击更新 UI 计数，窗口调整大小与正常退出成功。未在 DAW 中加载 VST3。
- VST3 实际插件的 `IPluginFactory3` component/controller class info 均报告正确中文名称。单独真实 JUCE helper fixture 也通过 `安排 🙂 & Product`，证明非 BMP 字符可写入 manifest。
- 实测发现并修复 JUCE 8.0.12 VST3 shell 参数、UTF-8 转 UTF-16 class info，以及 SDK manifest converter 拆分 surrogate pair 的问题。兼容改动只作用于构建树，精确匹配上游定义；依赖 checkout 未修改。

## 证据

忽略的完整验收材料在仓库工作区 `build/cli-presentation-final/`：

- `products.json`：Debug/Release 与元数据、图标变更阶段的打包检查摘要。
- `acceptance-fixed.log`、`acceptance-changes.log`：create/configure/build/package 完整链路与图标变更验收。
- `factory-unicode.log`、`manifest-unicode.json`、`unicode-helper-fixed.log`、`manifest-emoji.json`：VST3 factory 和中文/emoji manifest 检查。
- `gui.json`、`release-window.png`：最终 Release 实机窗口、应用身份和点击结果。
- `tests-final.log`、`node24-tests-final.log`、`root-tests.log`、`typecheck.log`：测试与静态检查。

临时工程位于对应材料 `context.json` 指向的 `工程 with spaces`。构建使用本机 Xcode/AppleClang 21、CMake 4.2、Ninja 1.13、Node 26.5；CLI 另以 Node 24.19 运行测试与入口检查。

## 未完成项

- 在 Windows 实机验证 Debug/Release、ICO/VST3 shell 图标、MSVC 资源编译与打包。
- 未执行 DAW 插件扫描/加载；VST3 目前完成实际二进制 class factory 检查。
- 未创建提交或发布包。
