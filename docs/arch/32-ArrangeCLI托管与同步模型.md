# Arrange CLI 托管与同步模型

本文是 CLI 工程文件托管、扫描和同步的长期事实源。命令与工程形态见 [Arrange CLI 与工程模式](31-ArrangeCLI与工程模式.md)。

## 状态与无状态定义

`ProjectState` 是一次 CLI 操作的完整状态，包含 `rootDir`、共享 `project` 配置和本机 `local` 配置。File、Cluster、Region、ManagedItem 都是无状态定义；它们只在传入 state 后计算路径、期望值或生成文本。

```txt
物理关系：ManagedFile → Cluster → Region
逻辑关系：ManagedItem → 多个 Region
```

Cluster 是 Region 的地理／实物父级。ManagedItem 是 Region 的逻辑／家族父级，可以跨文件、跨 Cluster 关联多个 Region。两种关系不可混为一套拓扑。

## File、Cluster 与 Region

File 负责文件路径、文件级读取、文件缺失或不可解析的判断，以及整文件创建。TextFile 继续向下联结多个 Cluster；JsonFile 直接联结 JsonRegion。

Cluster 负责一段可验证的文本结构，提供定位、结构缺失／损坏判断和结构创建。Cluster 只生成自身外壳，内部内容委派给所属 Region；不能把整个文件冒充 Cluster。

Region 负责一个具体字段或片段的定位、期望值计算、检查和更新。Region 可选择受托管 wrapper；创建时未启用托管的 Region 生成普通内容，不写 wrapper，也不参加后续 sync。

## 托管项

ManagedItem 表达用户选择的逻辑托管家族。一个 Item 可拥有跨文件、跨 Cluster 的多个 Region，例如 framework 版本同时约束 package.json 依赖和 CMake FetchContent tag。启用状态只由 `ProjectState.project.managed-items` 决定。

## 同步状态机

CONFIG 与 SETUP 都采用同一状态机：

```txt
SCAN
  ↓ 无阻塞问题
APPLY

SCAN
  ↓ 有阻塞问题
RESOLVE → 产生副作用 → 重新加载 ProjectState → 全量 SCAN
```

SCAN 只读取和计算，不写文件、不改配置、不运行外部命令。扫描从文件到 Cluster 再到 Region；父级缺失或损坏时跳过子级，避免凭空制造子级事实。

RESOLVE 每次处理扫描结果中的首个阻塞问题。所有自动化候选都必须征得用户同意；无法可靠定位时由用户选择位置或插入临时定位 marker。写入或改配置后必须重新扫描，不能在内存中手工拼接级联结果。

阻塞问题的基本处理：

| 问题 | Resolve 行为 |
|---|---|
| 文件缺失 | 询问是否创建；确认后创建并重扫 |
| Cluster 缺失／损坏 | 智能给出候选；用户确认或手动定位；写入后重扫 |
| Region 缺失 | 给出可确定插入点；否则用户选位置或贴 marker；写入后重扫 |
| 未包裹但疑似存在 | 询问接管、删除或放弃 |
| `extraneous` | 删除、承认现状并更新配置、放弃 |
| 配置非法 | 报错终止，不猜测 |

承认现状意味着用户确认当前内容，将其转换为配置值；只改变对应配置事实，不隐式关闭整个 ManagedItem。

APPLY 只处理已经确定的常规更新，例如 wrapper 内的 outdated 内容。它不再做决策，也不需要重新扫描。

## 临时定位与 wrapper

RESOLVE 中用户插入的临时定位 marker 只用于确定一次写入位置，写入后被消费。长期 wrapper 用于后续 Region 定位和托管；两者不是同一种标记。

## `.arrange/`

`.arrange/` 是工程本机工作目录，与 `arrange.local.yaml` 一样不提交 Git，但不属于 ProjectState 的共享配置。它可以承载 Apply 事务 journal、恢复信息和未来的扫描缓存。

首版只要求事务记录：事务 ID、涉及文件、原内容 hash、预期新内容 hash、写入进度和完成状态。缓存可以丢弃，未完成事务记录不能被普通缓存清理删除。

Apply 在写入前生成并校验所有新内容，使用临时文件替换目标文件，并在 journal 中记录进度。多文件替换不宣称操作系统级绝对原子；中途恢复时按内容判断：原内容表示未写入，预期内容表示已写入，二者都不是则要求用户处理外部修改。

## 当前边界

当前优先实现可可靠定位和读写的 File、Cluster、Region。无法百分之百确定的结构交给交互，不通过字符串猜测或旁路规则掩盖不确定性。adopt、build、dev、package 必须复用这套定义，不能另建生成、扫描或托管语义。
