# 定位

Demo 是 Arrange 的实际测试场地，也是面向用户的主样板，不是玩具式样板。

它承担：

- authoring 体验实验室。
- 框架整体链路验收场。
- 真实宿主测试插件。
- 文档截图与 smoke artifact 来源。

Demo 数量宁少勿多。优先维护一个长期成长的主 Demo，而不是多个散装示例。

Demo 必须走真实消费路径：TS 侧通过 `@arrange/framework`，C++ 侧通过 `Arrange::framework`。除非确有必要，不另建其它伪 Demo。

# 工程形态

```txt
demo/
  plugin-src/
    ...
  ui-src/
    ...
```

`ui-src/` 是 UI 源码项目；发布运行时的 `ui/` 是构建产物目录。

Demo 是独立用户样板，不从根 CMake 作为内部子工程构建。根 CMake 不提供 `ARRANGE_BUILD_DEMO`。

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
- Demo 的工程形态应保持用户样板，不依赖仓库内部特供消费路径。
