# 定位

Demo 是 Arrange 的“实际测试场地”，也是面向用户的主样板，不是玩具式的样板。

它承担：

- authoring 体验实验室。
- 框架整体链路验收场。
- 真实宿主测试插件。
- 文档截图与 smoke artifact 来源。

Demo 数量宁少勿多。优先维护一个长期成长的主 Demo，而不是多个散装示例。

Demo 应尽量走真实消费路径：TS 侧通过公开包入口，C++ 侧通过公开 native 接入。除非确有必要（特殊测试目的，不方便集成进 Demo），不另建其它伪 Demo。

# 目标形态

建议目录：

```txt
demo/
  plugin-src/
    ...
  ui-src/
    ...
```

`ui-src/` 是 UI 源码项目；发布运行时的 `ui/` 是构建产物目录。

# 插件形态

Demo 插件目标：

- Standalone。
- VST3 Effect。

选择 Effect 而非 Instrument，是为了减少 MIDI 处理干扰，更适合快速真实宿主测试。

不实际处理音频：参数仅用于 Demo 测试，不会对实际声效产生影响。

# 具体实现

Demo 的复杂度随里程碑增长。早期可以很小，但必须能反馈 Arrange 的开发体验和运行效果。

Demo 可以逐渐复杂；模板必须干净、克制、适合新项目复制。

# 里程碑贯穿规则

每个里程碑都必须更新 Demo：

- 新能力进入 Demo。
- Demo smoke 覆盖主链路。
- Demo 暴露 authoring 体验问题，并反向修正 API。
- Demo 的工程形态应逐步趋于用户样板，不应长期依赖仓库内部特供消费路径。


