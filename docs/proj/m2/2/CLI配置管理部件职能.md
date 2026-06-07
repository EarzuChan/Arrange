# CLI 配置管理部件职能

本文仅限定 `create`、未来 `adopt`、`sync` 的 config 文件管理相关部件。

## 总精神

- `Generator`：从无到有创建文件/结构。
- `ManagedItem`：定义托管语义。
- `TextRegion / JsonRegion`：定义具体内容。
- `Cluster`：文本结构识别与落点。
- `Checker`：检查。
- `Performer`：执行。
- `AdoptDetector`：识别旧工程。
- `Wizard`：交互。

## Generator

统一负责“从无到有”创建文件和基础结构。

职责：

- create 时创建项目文件：核心是建文件，建好多（一套）文件。
- sync/adopt 时补建缺失文件：核心也是建文件，建指定的文件。
- 创建一个文件中：生成纯 one-shot（非Managedable）部分，生成 managedable carrier 的基础结构。
- 对 managedable 内容，调用 managed 系统写入。

不负责：

- sync 检查。
- 判断 managed item 是否过期。
- adopt 检测。
- 直接维护 managedable 内容的多套生成逻辑。

## ManagedItem

多态设计，而不是一个万能类硬塞所有字段。

共有职责：

- 每一个实现都有特异 item key。
- 从 `ProjectState` 计算 desired。
- 判断 desired 是否有效。
- 描述自己如何落到文件里。

## TextFileManagedItem

用于 CMake、npmrc 等文本文件。

职责：

- 提供一个或多个 `TextRegion`：每个 region 有其归属的 cluster。

不负责：

- 定位 CMake/npmrc 结构。
- 具体检查、编辑内容。

## JsonManagedItem

用于 package.json 等结构化 JSON 文件。其不需要 cluster。

职责：

- 提供一个或多个 `JsonRegion`。

## TextRegion

文本 managed item 的具体内容区域。

职责：

- 检查，返回 Result。
- 编辑（生成）Region内容，并返回。
- 未来或会负责内容提取：供Adopt流程使用。

## JsonRegion

JSON managed item 的具体结构路径。

职责：

- 检查，返回 Result。
- 编辑（生成）Json对象的目标点位的值。
- 未来或会负责内容提取：供Adopt流程使用。

## Cluster

只用于文本文件。

职责：

- 识别结构，例如 `juce_add_plugin(...)`。
- 调用 region 以获得每 region 的位置。调用 region 进行检查、编辑...
- perform 时物理**编辑**（没有生成！）其负责的结构区域。

不负责：

- 计算 desired。
- 生成整个文件的壳子。
- 生成具体点位文案内容（这是 Region 负责）。
- 与用户交互。

## ManagedConfigChecker

sync config 检查阶段。生成总 report。不修改文件。

## ManagedConfigPerformer

sync config 执行阶段，消费 report，直接进行进一步：

- 自动更新安全项。
- 对新增、删除、接管、冲突等调用交互。
- 调 cluster/json handler 写入。

## AdoptDetector

未来 adopt 使用。

职责：

- 复用 cluster/json region 读取现有工程。
- 收集可识别信息。
- 收集可接管项。
- 生成 adopt report。

不直接修改文件。
