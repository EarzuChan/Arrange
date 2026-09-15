# SCAN 结果与 RESOLVE 对策

本文只定义 M2.2 当前扫描报告的结果分类和交互对策。模型本身见 [Arrange CLI 托管与同步模型](../../../arch/32-ArrangeCLI托管与同步模型.md)。

## 文件级

| 层级 | kind | 含义 | SCAN 行为 |
|---|---|---|---|
| 文本文件 | `present(text)` | 文件可读取 | 下钻 Cluster |
| 文本文件 | `file-missing` | 文件不存在 | 报告阻塞问题，不创建 |
| JSON 文件 | `present(json)` | 文件存在且可解析 | 下钻 JsonRegion |
| JSON 文件 | `file-missing` | 文件不存在 | 报告阻塞问题，不创建 |
| JSON 文件 | `unparsable` | 文件存在但无法解析 | 报告阻塞问题，不修改 |

## Cluster 级

仅在文本文件存在且可读取时下钻 Cluster；Cluster 缺失或损坏时跳过其下所有 Region。

| kind | 含义 | RESOLVE 对策 |
|---|---|---|
| `found(span, text)` | 定位到唯一结构 | 继续扫描 Region |
| `missing` | 找不到结构 | 智能定位并确认；否则用户定位或贴临时 marker，写入后重扫 |
| `ambiguous(candidates)` | 存在多个候选 | 用户选择；不接受则手动定位或放弃 |
| `damaged(message)` | 结构边界损坏 | 用户修复、重新定位或放弃；确认写入后重扫 |

## TextRegion 级

仅在所属 Cluster `found` 时产生 Region 结果。

| kind | 含义 | RESOLVE／APPLY 对策 |
|---|---|---|
| `idle` | 当前内容与配置一致 | 丢弃 |
| `outdated(current, expected)` | 已托管内容过期 | 进入 APPLY 批量更新 |
| `missing(insertAt?)` | 没有目标区域 | 用户确认插入点；写入后重扫 |
| `unwrapped-existing(current)` | 找到疑似内容但没有 wrapper | 接管并加 wrapper、删除、放弃 |
| `extraneous(current)` | 配置期望为空但文件中仍有内容 | 删除、承认现状并更新配置、放弃 |
| `wrapper-damaged(message)` | wrapper 标记不完整或顺序错误 | 用户修复、重新定位或放弃 |
| `config-invalid(message)` | 无法从 state 计算合法期望值 | 报错终止 |

如果 `insertAt` 不能安全确定，不能自动猜位置；用户可以选择候选位置，或在文件中贴临时定位 marker 后重新扫描。

## JsonRegion 级

仅在 JSON 文件 `present(json)` 时产生结果。

| kind | 含义 | RESOLVE／APPLY 对策 |
|---|---|---|
| `idle` | 字段已对齐 | 丢弃 |
| `outdated(current, expected)` | 字段值过期 | 进入 APPLY 批量更新 |
| `missing` | 目标字段不存在 | 用户确认补入后重扫 |
| `extraneous(current)` | 配置期望为空但字段存在 | 删除、承认现状并更新配置、放弃 |
| `config-invalid(message)` | 无法计算合法目标值 | 报错终止 |

## 统一循环

```txt
SCAN → 有阻塞问题 → RESOLVE 首个问题
     → 有副作用 → reload ProjectState → 全量 SCAN
SCAN → 无阻塞问题 → APPLY 确定性更新
```

`--scan` 只输出报告并结束；SCAN 本身不写文件、不改配置、不运行外部工具。
