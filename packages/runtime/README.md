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

## 第 4–5 步：局部执行与动画

`animatedNumberAsRef`、`animatedDpAsRef`、`animatedColorAsRef`、`animatedNumberArrayAsRef`、`animatedOffsetAsRef`、`animatedSizeAsRef`、`animatedRectAsRef` 接受普通初值、Ref 或 getter，返回只读 Ref，并提供 `isRunning` Ref 和 `stop()`。setup 中目标要随状态改变时传 Ref/getter；普通值仍是快照。实例自动随创建时的 effect scope 销毁。固定长度数值组拒绝长度变化。

```ts
const color = animatedColorAsRef(targetColor, {
    animationSpec: tween({durationMillis: 240, easing: easing.fastOutSlowIn}),
})
const movement = animatedOffsetAsRef(() => ({x: expanded.value ? 40 : 0, y: 0}), {
    animationSpec: spring({stiffness: 220, dampingRatio: 0.8}),
})
const group = createTransition(expanded) // transition(...) 为同一工厂入口
const alpha = group.animatedNumber('alpha', open => open ? 1 : 0)
```

所有 JS 动画共享所属时钟的一次 VBlank callback，先采样所有 channel，再批量通知观察者。Transition 子值共用目标时间戳、生命周期和取消规则，label 不能重复；子值 `stop()` 会从 Transition 退休。spring 使用解析解，跳帧不改变轨迹，中断保留当前呈现值及速度。tween 支持 delay/easing，snap 支持延迟；生产没有 timer fallback。`createManualAnimationClock` 仅用于确定性测试。

`AnimatedVisibility` 接受 visible、animationSpec、appear、enterFrom/exitTo（alpha、translationX/Y、scaleX/Y）。退出开始即禁用宿主子树交互，原生发布同时清理焦点；内容保留到退出完成，反向切换复用正在退出的结构。`Crossfade` 接受 targetState、animationSpec，默认 slot 的 `{state}` 属于各自保留内容；快速 A→B→A 会复用尚未退休的 A。

`m.animateContentSize(spec, {clip: true})` 是真正的原生布局 Modifier。它在所在层测量自然尺寸，保留当前动画尺寸用于父布局；内部内容仍按目标自然尺寸放置，并按本层动画边界裁剪绘制和命中。第一次测量直接显示自然尺寸，后续改变用 VBlank 推进，重定向保留当前值；删除实例、reload/reset 自动退休。它接受 spring、snap、使用内建或 cubicBezier easing 的 tween；任意 JS easing 不能跨到原生测量阶段，因此明确报错。

measure/place 现在分别按实际约束、输入与位置复用；绘制、命中使用不可变子树片段，Modifier 绘制层独立复用。相等 typed 输入在 JS 提交前和原生输入边界消除。固定原厂 m 链可由编译器拆成独立参数 computed；helper 调用、成员访问、动态链和不能证明安全的表达式维持普通求值。提交优化只对匹配已发布 kind/key 的实例句柄生效，结构变化仍走正式整链协调。

诊断提供实际节点测量/放置数、缓存命中、绘制层构建、命中片段、原生动画采样、阶段耗时、JS 值域耗时、参数求值与 Modifier 分配计数。候选 scene 仍复制节点状态以保持失败回滚；发布时仍展平显示列表，JUCE 对变化显示列表仍按整视口栅格重绘。这些开销有单独计数与原因，没有伪称局部栅格重绘。
