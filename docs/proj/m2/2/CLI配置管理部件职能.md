# M2.2 CONFIG 部件分工

目标目录分工见 [CLI 架构](../../../arch/31-ArrangeCLI与工程模式.md#简明架构说明)，模型与接口见[托管模型](../../../arch/32-ArrangeCLI托管与同步模型.md)，执行顺序见[命令流程](命令定义.md)。下列名称表示职责，不要求各自建立一个类。

| 调用方 | 委派对象 |
|---|---|
| SyncService | CONFIG、SETUP 各自的 LSRA |
| CONFIG SCAN | State 读取、参与拓扑、File.check，收集四类结果 |
| CONFIG RESOLVE | 共用交互、对象定位与生成、文件写入 |
| CONFIG APPLY | 最后一次扫描确定的更新、按文件组合与写入 |
| create/adopt 的新文件生成 | File.make |

RESOLVE 可返回 `abort`、`rescan` 或 `ready-to-apply`，由 SyncService 继续编排。返回后如何处置 State、结果与定位，遵循[LSRA](../../../arch/32-ArrangeCLI托管与同步模型.md#config-与-setup-的-lsra)；写入失败按[事务约定](../../../arch/32-ArrangeCLI托管与同步模型.md#arrange-与写入失败)处理。

CONFIG 实现与验证状态见[第三期工作区](第三期M2.2的工作.md#config-验证)。SETUP 的具体检查项与交互待设计。
