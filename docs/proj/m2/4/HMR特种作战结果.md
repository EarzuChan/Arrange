# HMR 特种作战结果

2026-09-23，macOS / QuickJS-NG 0.14 / Vite 8。

## 已落地

- dist 继续单文件 `app.js` bundle；live 使用 `/@arrange/modules` 的 Vite transformed ESM 快照，删除每次请求执行 `vite.build()` 的旧 dev-bundle 实现。
- 两条路径的职责已经固定：live 只执行 transformed ESM module graph，并由 Vite HMR 消息驱动同一 QuickJS context 的更新；dist 只从已生成的 `app.js` bundle 启动。live 首次连接失败时允许加载已配置 dist 作为启动容错，但不会把 dist 当成 live 更新实现，也不会从 dist 反向生成 HMR。
- 快照保留模块 URL、源码和 source map。后台线程取图，UI Owner 安装快照，QuickJS 原生 loader 同步读取内存；版本 URL 创建新 module record，不修改 QuickJS 源码、不强拆旧 module cache。
- 动态 `import()` 先异步获取所需模块图，再交给 QuickJS 原生 import/link/evaluate；支持 TLA。完整 reload 后，旧会话的异步响应不会污染新 context。
- 无 HTML、DOM、CSS client；支持 Vite 的 JS update、custom、prune、full-reload，以及 `accept`、依赖 accept、`dispose`、`data`、`prune`、`invalidate`、`on/off/send`。传播边界和反向依赖沿用 Vite，invalidate 回送 Vite。
- 已移除旧的 `arrange:reload` 自定义客户端和旧 dev-bundle 路径，避免 live HMR 与旧整包重载形成双轨。
- QuickJS 与 C++ 通过直接读写 JSValue 交接类型化消息。JSON 只用于 dev server 的 HTTP/WebSocket 网络协议，不用于 QuickJS/native 语义桥。
- SFA 编译稳定 `__hmrId`，独立模板工厂保留 setup 词法作用域；模板更新保留 Arrangable、ref 和仍可复用的 native 节点。兼容脚本更新重新建立 setup 效应，在重排事务提交后释放旧效应，保留调用账本与 native 身份；回滚会清理候选 setup。
- 明确迁移直接声明的 `ref`、`shallowRef`、`reactive`、`shallowReactive`、`createScrollState`；computed、watch 和事件函数重新建立。外部依赖 namespace 变化也会刷新 setup，避免仅更新模板却继续使用旧依赖。

## 边界

- 任意 JS 局部变量不自动迁移；模块共享状态显式使用 `hot.data`。状态声明按变量名和工厂身份识别，任意自定义工厂不在自动迁移范围内。
- props/slot 契约改变会重挂载该 Arrangable；包含 provide/inject、挂载/卸载/激活钩子的脚本变化保守重挂载，避免旧闭包与新生命周期混用。
- 无 accept 边界时完整 reload；framework/reactivity/shared 自身保存基础身份，修改这些实现也完整 reload。
- 老版本 ESM 记录随 context 保留，完整 reload 统一释放；dispose/prune 负责应用副作用清理，不提供危险的逐模块强制卸载。
- live WebSocket 延续本地 http/ws 范围；未引入 HTTPS/WSS 或浏览器 API 模拟。

## 验证

- 新增 `tests/runtime/live-hmr.test.ts`：模块协议、失败恢复、模板状态与节点身份、依赖更新、兼容脚本迁移及不兼容重挂载；setup 或 native 提交失败均回滚候选状态表，避免新增状态泄漏到后续更新。
- 新增 `arrange_live_modules` 原生测试：原生 ESM cache、多版本共存、live binding、dynamic import、TLA、类型化消息。
- `node --import tsx scripts/verify-live-hmr.ts`：真实 Vite → 后台取图 → QuickJS；验证同 context 更新、dispose/data、动态导入、语法错误修复、invalidate 冒泡与 full reload。
- macOS Debug Standalone 已构建并启动为 `[Debug live]`；实际修改 App.sfa 模板可直接更新窗口，联调文案已恢复。首次冷模块图约 4.1 秒，缓存请求约 52 毫秒（本机单次观测，不是性能承诺）。
- dist 构建仍仅输出 `app.js`；typecheck 通过，针对性 HMR/SFA/事务及 Vite 测试 45/45 通过（含动态 import 辅助名称冲突回归），原生 ESM 与 core/QuickJS/JUCE smoke 4/4 通过。

额外回归没有伪装成全绿：全量 runtime 测试发现已有 density 单位检查失败；直接调用未经 HMR 的原始编译入口也能复现。全量 native build 被 `arrange_local_work.cpp` 的 size_t → uint32_t 窄化初始化阻塞；额外 `arrange_frame_submission` 在无 peer 的资源完成/message-thread 断言未通过。这些问题与本次 HMR 测试分别记录，未用跳过断言或改动单位语义掩盖。

Standalone 渲染和 live 重连正常，但 Debug 日志仍出现 `juce_Component.cpp:1658` 断言；本次未定位该断言，不将其报告为已解决。
