# M2.2 CONFIG 扫描验收用例

扫描矩阵、四类结果及其数据定义见[托管模型](../../../arch/32-ArrangeCLI托管与同步模型.md#config-scan-的四类结果)，交互顺序见[命令流程](命令定义.md)。本文只列本期验收案例。

## 合并报告的示例

假设工程同时出现：

- `ui/package.json` 语法不合法。
- `native/CMakeLists.txt` 可读，但目标 Cluster 没有 Wrapper。
- `ui/.npmrc` 的 Cluster 与受管 Region 都可定位，registry 正文过期。

完整 SCAN 应同时给出：

```txt
Fatal
  ui/package.json: unparsable
Resolvable
  native/CMakeLists.txt: 目标 Cluster missing
Applicable
  ui/.npmrc: registry Region outdated
```

package.json 下的 JsonRegion 与缺失 Cluster 下的 TextRegion 不产生结果。RESOLVE 因 Fatal 阻断，无修复或更新写入。

## 本期验收案例

| 场景 | 应验证的结果 |
|---|---|
| ManagedItem 关闭，文件缺失、Region 有裸内容或有旧 Wrapper | 对该 ManagedItem 均不生成 Issue；不因它要求父级存在 |
| 两个 ManagedItem 共用一个 Cluster，只开启一个 | 只检查开启 ManagedItem 的 Region，保留其他内容 |
| TextFile 不存在，另一个文件可读 | 只在缺失文件处报 missing，其后代不进入扫描；另一个文件继续扫描 |
| 同一 ManagedItem 跨文本和 JSON，其中一个物理父级失败 | 另一分支照常扫描，但本轮不能提前 Apply |
| 共同托管的名称/Framework 版本改变 | 两端使用各自格式更新，保留 CMake target、源路径和普通自定义内容 |
| FetchContent 地址与 Framework 版本只托管其一 | 更新对应 Region，另一项及其关联内容保持原样 |
| 共同托管项使用 `--ui` 或 `--native` | 只更新所选物理分支，YAML 中的共同开关不变 |
| File 内、Cluster 前有普通文本，Cluster 内有 Region Wrapper | Cluster 定位相对 File；Region 定位相对 Cluster inner；两者 outer/inner 截取正确 |
| State 中切换 ManagedItem 开关后生成文件 | 同一 make 入口按 State 生成带 Wrapper 或裸 Region，Cluster 自身 Wrapper 保留 |
| Cluster 标记完整，某个 Region 标记缺失 | Cluster located，Region missing；其他可可靠定位的 Region 继续检查 |
| Wrapper 少一端、重复或交叉闭合 | damaged；不暴露猜测的写入 span；受影响区域不进入扫描 |
| 可选文本值为 `~`，Region 没有 Wrapper | missing；确认建立空 Wrapper 后，重扫得到 idle |
| 可选文本值为 `~`，完整 Wrapper 中有赋值语句 | outdated；Apply 仅清空正文 |
| 配置为合法空字符串，正文为 `@arrange:registry=` | 根据实际生成正文比较，不当作 null |
| 受管正文多了注释、语句或空白 | 按完整正文比较得到 outdated，替换后周围自定义文本不变 |
| JSON 期望字段不存在，现实字段为显式 null | outdated；移除该字段，保留相邻字段 |
| JSON 期望有值，目标路径的父对象不存在 | missing；确认补入时创建缺少的容器 |
| `dependencies` 为 `123`，目标在其下面 | Region damaged；要求用户手动编辑，不覆盖父值 |
| 一份报告同时有四类结果 | 全部展示，Fatal 优先阻断，无任何 Resolve/Apply 写入 |
| 用户给已有 Region 补 Wrapper | 继续后全量重扫；不询问反哺配置，差异转为 Applicable |
| 用户修复一个 Issue，另一个因此发生变化 | 丢弃旧报告，重新生成全部判定，不处理旧队列的下一项 |
| 用户未修好或取消 | 未修好仍报告问题；取消 Abort，不能进入 Apply |
| `--scan --config` | 输出完整报告，无文件、配置或外部工具副作用 |
| CONFIG Apply 成功 | 当前 CONFIG LSRA 结束，不自动追加复检循环 |

对应自动化测试与执行结果见[第三期工作区](第三期M2.2的工作.md#config-验证)。
