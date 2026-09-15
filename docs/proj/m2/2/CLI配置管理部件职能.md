# M2.2 CLI 配置管理部件职能

本文是 M2.2 当前施工期的 sync 实现指导。长期模型见 [Arrange CLI 托管与同步模型](../../../arch/32-ArrangeCLI托管与同步模型.md)，命令与工程形态见 [Arrange CLI 与工程模式](../../../arch/31-ArrangeCLI与工程模式.md)。

## 工作部分

sync 分为两个独立但共用状态机的部分：

- **CONFIG**：同步 `arrange.project.yaml` 所描述的工程文件、托管区域和项目配置。
- **SETUP**：同步 `arrange.local.yaml` 所描述的本机工具链、依赖和 ready 状态。

无范围参数时处理两部分；`--config` 与 `--setup` 互斥。`--ui` 与 `--native` 也互斥，无范围参数时同时处理 UI 与 native。

## 状态机

```txt
LOOP {
    SCAN：纯读取，尽可能完整地建立问题报告
    if scan-only：打印报告并结束
    if 有阻塞问题：RESOLVE 首个阻塞问题
        若产生副作用（涉及文件改变，不管是配置项文件还是被托管的文件，都算作副作用！所以 RESOLVE 应看作是基本会产生副作用的）：重新加载 ProjectState，再次完整 SCAN
    若无阻塞问题：退出 LOOP
}
APPLY：批量执行已经确定的常规更新
```

SCAN 不创建文件、不修改配置、不运行外部命令。扫描按 File → Cluster → Region 的父子关系下钻；父级缺失或损坏时跳过子级，修复后依靠重新扫描产生新的子级事实。

RESOLVE 所有操作都需要用户确认。能够可靠推断的位置可以给出智能候选；用户拒绝候选或候选不唯一时，进入手动定位的临时 marker 流程。写入文件或修改配置后，必须重新读取 YAML 并从头扫描。

APPLY 只处理 `outdated` 等没有决策歧义的更新，不再询问用户，也不需要重新扫描。

## Resolve 对策

| 扫描问题 | 处理方式 |
|---|---|
| 文件缺失 | 询问是否创建；确认后由 File 创建并重扫 |
| JSON 无法解析 | 报告并要求用户修复或放弃，不猜测 JSON 内容 |
| Cluster 缺失或损坏 | 智能定位并确认；否则用户定位或贴临时 marker；写入后重扫 |
| Region 缺失 | 提供可确定插入点；没有安全插入点时由用户选择或贴 marker；写入后重扫 |
| 未包裹但疑似存在 | 接管并加 wrapper、删除、放弃 |
| `extraneous` | 删除、承认现状并更新配置、放弃 |
| 配置非法 | 立即终止并说明配置错误 |

“承认现状”只修改对应配置事实。若一个 ManagedItem 关联多个 Region，只更新用户明确承认的那项事实，不隐式关闭整个 ManagedItem。这个需要具体盘算（也许ManagedItem支持到细粒度的Region开关状态？）。

## 部件职责

- `ProjectState`：统筹工程根、共享配置和本机配置。
- `ManagedFile`：无状态地计算路径、读取文件状态和创建整文件。
- `Cluster`：无状态地定位和创建一段实际结构，并委派子 Region。
- `Region`：无状态地定位、计算期望值、检查和更新具体字段或片段。
- `ManagedItem`：表达逻辑托管家族，关联可跨文件、跨 Cluster 的多个 Region。
- `ScanReport`：保存本次扫描的文件状态、位置、问题和可用候选，不执行修复。
- `ResolveService`：执行交互式修复，负责副作用后的 state reload 和重新扫描。
- `ApplyService`：根据最终报告生成并提交确定性的文件更新。

## `.arrange/`

`.arrange/` 是工程根下的本机工作目录，和 `arrange.local.yaml` 一样不提交 Git，但不属于共享配置。当前施工只使用它记录 Apply 事务 journal 和恢复信息；扫描缓存暂不实现。

Apply 先生成并校验全部新内容，再用临时文件替换目标文件，并记录原内容 hash、预期内容 hash 和进度。中途失败时根据内容判断已完成步骤；发现文件被外部修改时，交给用户处理。

## 当前实现顺序

1. 统一 `ProjectState` 和路径解析。
2. 落地 File／Cluster／Region／ManagedItem 定义与物理／逻辑拓扑。
3. 实现 CONFIG SCAN。
4. 实现 RESOLVE 与全量重扫。
5. 实现 Apply journal 和文件事务。
6. 让 create 复用同一套生成链。
7. 实现 SETUP，再接入 build、dev、package 和 adopt。
