# Arrange runtime 的执行边界

用户使用 `@arrange/framework`。SFC 由 Arrange Vue 编译，原厂元素和 Modifier 通过 typed binding 提交给原生执行。

- `setup` 每个组件实例执行一次。`ref`、`reactive`、`computed` 按实际读取收集依赖，不保存固定的结构、布局或绘制用途。
- 模板结构执行域处理分支、keyed 列表、动态组件和 slot 结构。普通输入、文本、事件和整条 Modifier 表达式拥有持久值绑定。父 props 更新由子组件实际消费者响应，不必重跑子模板。
- 普通 helper 在调用它的执行域内读取 Ref。模板的 `m.background(color)` 会延后整段表达式；提前在普通 TS 中读出的值无法追溯为延迟读取。手写 render 可以使用 `arrangeValue(() => expression)` 明确建立值执行域。
- 默认 `watch` 在所属组件结构更新前执行，值绑定在该组件结构协调之后执行，`flush: 'post'` 在本轮 JS 更新后执行；`flush: 'sync'` 同步执行。分支删除会停止订阅并取消排队值任务。
- `mounted` 表示逻辑宿主树已经挂载；`updated` 对应组件结构执行。纯值更新不会伪造组件结构更新钩子。
- `nextTick()` 等待 Vue 的 JS 更新队列完成。它不等待屏幕 VBlank，也不承诺原生测量、放置或发布已经完成。`flush: 'post'` 同样不表示画面已呈现。

生产画面仅由 VBlank 推进：输入事件、一次动画采样、JS 工作稳定化、统一提交、原生 measure/place/DrawOps/hit 构建、资源与输入 overlay/诊断准备，最后统一发布。颜色只需重建绘制；offset 可以复用测量。paint 只消费 PublishedFrame。原生发布计数与 revision 是原生帧完成证据，不用 nextTick 或 mounted 代替。

Modifier 是有序且允许重复的描述链。无 key 元素按类型与相对顺序匹配；显式 `keyed` 允许跨位置复用。原生生成的实例 handle 不等于数组下标或 key。内部 native 协议的 `modifierInstances(nodeId)` 返回已发布实例身份，`registerModifierBinding(nodeId, handle)` 绑定单个实例输入；`updateBinding` 接受同类型 ModifierElement，不能把实例改成另一种类型。模板通用表达式仍使用整链协调。

绑定与事件资源归属组件、节点和具体实例。解绑、删除、替换和 context reset 使旧 handle 失效；迟到写入先校验身份，再解码值。资源和布局构建失败不会发布部分几何。未被组件错误边界处理的 JS 错误、微任务未处理拒绝或永久非法提交会停止当前生产 context，保留上一帧几何并发布错误诊断。reload/HMR 创建新 context，退休旧绑定、回调、焦点和动画；不尝试回滚任意 JS 副作用。

手动 reload、脚本 reload 与 HMR 都只提出重载请求，由宿主在 VBlank 边界重新加载包。JS 在当前帧中提出的请求会先进入宿主 action 队列，再由后续 VBlank 消费；请求未消费前不会停止帧时钟。

原生测试可以使用 ManualVBlankSource 驱动相同 VBlank 入口。核心候选提交支持保留失败提交并在显式请求时重试；生产错误 context 通过重载恢复。
