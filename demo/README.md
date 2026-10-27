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

---

Demo 不直接依赖本仓裸代码，而是通过包关系（NPM package 和 CMake FetchContent Git repo；不管是 Local 还是 Remote）使用“发行了的依赖”。M4 施工期间 Demo 经本机来源消费 dev 版本（见[本机发包](../docs/proj/5：具体开发的额外约束.md#本机发包)），共享配置记录当前 dev 版本号。

长期工程边界与可选本机 FetchContent 源码覆盖见仓库内的 [Demo 母文档](../docs/arch/23-Demo.md)；本轮证据与实机待办见 [M2 工作区记录](../docs/proj/m2：已完成/2：初步完成，Win测中，待收尾/M2.2的最后工作中.md)。
