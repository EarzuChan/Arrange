# Arrange Vue 宿主目标

Arrange Vue 是 Arrange 的模板编译与响应式执行前端，服务于原生 LayoutNode、Modifier、typed mutation 和帧发布。用户视图通过 SFA 进入统一 Arrangable 调用与运行时；SFA 文件格式和模板语法的唯一事实源是 [SFA 与模板写法](33-SFA与模板写法.md)。

SFA 编译结果与直接代码编写的 Arrangable 使用同一 setup、参数、内容、重排和生命周期契约。模板调用不创建 VNode，不提供 HTML、DOM 或 CSS 兼容层；Layout 是深入原生节点应用层的唯一 Arrangable。对象身份与重排模型见 [运行时](04-运行时.md)。

宿主负责统一编译、TypeScript 转译、源码映射、Vite/HMR 与 QuickJS 交付。模板值、参数拒绝和原生 typed 提交保留源码位置；帧阶段、生命周期通知及提交边界见 [调度线程与帧阶段](26-调度线程与帧阶段.md)。

