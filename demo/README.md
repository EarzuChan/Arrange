# Arrange Demo

真实 JUCE Standalone / VST3 Effect 样板。在本目录执行已安装的 `arrange`：

```sh
arrange sync
arrange dev
arrange build --flavor release
arrange pack --flavor release --product standalone vst3
```

首次 `sync` 完成 CONFIG、工具发现、UI 依赖安装以及 Debug/Release native configure。`dev` 默认使用 Debug Live；就绪后 Ctrl+C / Esc 正常结束，准备和构建阶段 Ctrl+C / Esc 取消。Release build 默认整理两个产品，交付目录以 CLI 报告为准。

复制工程时携带 `arrange.project.yaml`、`ui-src/`、`plugin-src/` 和忽略规则，排除 `node_modules/`、`.arrange/`、`arrange.local.yaml`、`dist/`、`artifacts/`；在新目录重新运行 `arrange sync`。工具链与本机源码覆盖重新配置，不能复制旧构建树。

TODO、ENSURE：当前 `0.0.0-m.3.0` 的公开 npm 发布尚待完成。本轮迁移使用真实打包的 npm tarball，经临时本机 registry 安装验收；默认公网全新安装、发布后的锁文件复核尚未通过。请在版本正式可用后运行 `arrange sync` 并复核独立工程，不要改为仓库内部源码依赖。

长期工程边界与可选本机 FetchContent 源码覆盖见仓库内的 [Demo 母文档](../docs/arch/23-Demo.md)；本轮证据与实机待办见 [M2 工作区记录](../docs/proj/m2：初步完成，sub2待测试和收尾/2：初步完成，Win测中，待收尾/M2.2的最后工作中.md)。
