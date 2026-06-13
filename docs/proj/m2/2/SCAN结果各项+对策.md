SCAN 结果各项（分层级）与对策

**文件级**

| 层       | kind            | 含义                   |
|---------|-----------------|----------------------|
| 文本文件    | `present(text)` | 文件在 → 下钻簇            |
|         | `file-missing`  | 文件不存在 → 整文件生成（自动决定项） |
| Json 文件 | `present(json)` | 可解析 → 下钻域            |
|         | `file-missing`  | 文件不存在 → 整文件生成（自动决定项） |
|         | `unparsable`    | 文件不存在 → 整文件生成（自动决定项） |

（Text 无 unparsable：我们不整体 AST 解析文本，结构问题只在簇级显现。）

**簇级（仅 文本文件 有）**

| kind                 | 含义                                                                                        |
|----------------------|-------------------------------------------------------------------------------------------|
| `found(span, text)`  | 特征定位到 → 下钻其域                                                                              |
| `missing-or-damaged` | 定位不到（缺失/损坏不可辨）→ SCAN时其内域全跳过（前提门控）→ RESOLVE用户动笔贴MARKER（插入点位标记），我们识别到后替换为Cluster全新文本 → loop |

**TextRegion 级（仅当所属簇 found）**

| kind                                     | 含义                                  | 对策                                         |
|------------------------------------------|-------------------------------------|--------------------------------------------|
| `idle`                                   | 已对齐                                 | 丢弃                                         |
| `outdated(current, expected)`            | 自有 wrapped 内容值过期（各种和Expected不同就算过期） | 自动                                         |
| `missing`                                | 目标该有、域不在、无 unwrapped 疑似             | RESOLVE 处理：yes 就地创建空 wrapper→重跑 / no ABORT |
| `unwrapped-existing(current, expected?)` | 模糊匹配到疑似未托管内容                        | RESOLVE 处理：yes 就地 wrap→重跑 / no ABORT       |
| `wrapper-damaged(msg)`                   | 域 marker 撕裂                         | RESOLVE 处理：yes 用户动笔修 → loop / no ABORT     |
| `config-invalid(msg)`                    | 该域目标值算不出/非法                         | ABORT                                      |

**JsonRegion 级（仅当文件 present）**

| kind                          | 含义                                               | 对策    |
|-------------------------------|--------------------------------------------------|-------|
| `idle`                        | 已对齐                                              | 丢弃    |
| `outdated(current, expected)` | 字段值过期（各种和Expected不同就算过期，无该字段时，current=undefined） | 自动    |
| `config-invalid(msg)`         | 目标值非法                                            | ABORT |