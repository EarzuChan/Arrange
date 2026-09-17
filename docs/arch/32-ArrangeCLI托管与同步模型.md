# Arrange CLI 托管与同步模型

本文是定义、拓扑、ManagedItem、CONFIG 扫描矩阵和 LSRA 的唯一长期事实源。用户可见命令见 [Arrange CLI 与工程模式](31-ArrangeCLI与工程模式.md)，当期执行流程见 [命令定义](../proj/m2/2/命令定义.md)。

## 定义、State 与拓扑

`ProjectState` 包含 `rootDir`、共享 `project` 配置和本机 `local` 配置。操作必须发生在明确的工程根下；本机配置尚未建立时，`local` 可以为空。

File、Cluster、Region、ManagedItem 都是无状态定义：各级负责自身规则，并委派子级；具体路径、生成内容和检查结果由传入的 State 与本次输入产生。定义不保存某个工程的内容、span 或上次扫描结果，也不另建生成器复制这些规则。Region 直接从 State 读取对应配置值和 ManagedItem 开关，无需拓扑先提取后传入。

拓扑是本次操作的参与关系描述：哪些定义参与、对应哪些文件、如何关联。CONFIG 根据 State、启用的 ManagedItem 和命令范围推导拓扑，状态改变后重新推导。创建则根据 State 推导需要生成的文件及其子项，包括未托管的初始内容。两者使用同一套定义；拓扑不作为第二份配置保存，也不承载定位、生成或修复实现。

```txt
物理归属：TextFile → TextCluster → TextRegion
               JsonFile → JsonRegion
逻辑归属：ManagedItem → 多个 Region，可跨文件、跨 Cluster、跨文本与 JSON
```

Cluster 是 Region 的地理/实物父级，ManagedItem 是逻辑/家族父级。物理分组方便读取和写入；逻辑分组保证同一配置语义在多处共同受管。

```ts
type Region = TextRegion | JsonRegion

interface ManagedItem {
    readonly id: string
    readonly regions: readonly Region[]
}
```

物理父级与 ManagedItem 直接关联同一份 Region 定义；Region 不保存所属 File 或 Cluster。定义或描述符可以按固定参数特化，绑定关系仍是确定的；本次参与拓扑由 State 和操作范围推导。

具体 ManagedItem 在 `ManageItems.ts` 中分别以命名 `export const` 对象声明，自持 id、label 与跨文本/JSON 的 regions 数组；同文件定义 ManagedItem 类型及 managedItems 列表。物理定义分别位于 `CmakeStuffs.ts` 与 `NodeJsStuffs.ts`，不反向导入逻辑定义；Region 保留稳定的 managedItemId，扫描时校验逻辑归属一致性。物理文件入口列表由 ConfigScanner 维护。

## ManagedItem 与 expect

管理开关只到 ManagedItem，保存在 `project.managed-items`。Region 没有独立开关或覆盖项；确需独立管理的语义应拆成不同 ManagedItem。命令范围过滤不改变 ManagedItem 开关。

ManagedItem 的开关决定是否托管，其对应配置值经各 Region 自己的生成规则形成 expect。同一 ManagedItem 的多个 Region 可以生成不同格式的内容，不要求文本与 JSON 表达相同。

`project.name` 共同管理 CMake `PRODUCT_NAME` 和 package.json `name`，后者生成小写；`framework.version` 共同管理 FetchContent `GIT_TAG` 和 npm `@arrange/framework` 依赖版本，前者加 `v` 前缀。FetchContent 仓库地址独立管理。具体关联见 [ManageItems.ts](../../cli/src/managed/ManageItems.ts)。名称托管的范围仅为上述两个 Region；CMake target 名称和源文件路径属于创建时的初始内容，修改名称配置不代表完整工程重命名。

| ManagedItem | 对应配置 | CONFIG 中的期望 |
|---|---|---|
| 关 | 任意 | 忽略所属 Region，不定位、不比较、不要求内容或 Wrapper 存在 |
| 开 | 合法非 null 值 | 各 Region 生成对应的期望正文/JSON 值 |
| 开 | 合法 null，包括允许省略的字段 | TextRegion 期望空正文且有 Wrapper；JsonRegion 期望字段不存在 |
| 开 | 无法生成合法期望 | `config-invalid`，归入 Fatal |

`null` 与空字符串不同。可选字段的 YAML `~` 和省略表示 null；`""` 是一个实际字符串，不能通过真假值判断或 `trim()` 冒充 null。例如 registry 为 null 时不生成赋值语句；空字符串按模板生成 `@arrange:registry=`，若该配置不允许空字符串则报告配置非法。

ManagedItem 关闭时，创建仍按需生成一次性普通内容，文本 Region 不加 Wrapper。后续 CONFIG 完全忽略这些 Region，即使已有 Wrapper 也不检查或清理；用户负责其内容及后续工具的执行结果。重新启用 ManagedItem 后才纳入扫描。

只扫描参与 Region 所需的物理祖先。同一 File/Cluster 被多个 ManagedItem 共用时，只读取一次，再检查其中启用且在操作范围内的 Region；没有参与后代的父级不因 CONFIG 而被要求存在。

## 物理定义接口

所有 `check` 都结合期待与实情判断，只读和计算；各级的期待、实际输入和结果不同，具体判定见下文扫描矩阵。File 从 State 确定文件路径，读取后委派子级；Cluster 和 Region 在父级提供的内容中检查自身。

具体定义继承抽象基类，公共检查、定位和包装规则由基类实现。TextRegion/TextCluster 通过受保护的 `makeInner` 生成正文；JsonRegion 通过 `makeValue` 生成值，由公共 `make` 将 null 统一为字段不存在。File 子类实现 `path`，TextFile 实现 `make`，JsonFile 实现 `makeContent` 提供初始对象，再由基类委派 Region 填入字段。具体 File、Cluster、Region 均以 `export const xxx = new class extends ... {}()` 声明唯一实例，固定身份由字段声明。物理父级通过数组引用子定义，不在内部创建子实例；ManagedItem 关联同一份 Region；业务生成逻辑写在方法中，定义实例不保存工程状态。

| 定义 | check | locate | make(state) |
|---|---|---|---|
| TextFile | `check(state, path)`：读取并检查文件 | 无 | 整个文件文本，Cluster 内容委派其 make |
| TextCluster | `check(state, fileText)`：检查自身并委派参与的 Region | `locate(state, fileText)`：相对 File 正文的 outer/inner 区间 | 自身 outer，Region 内容委派其 make |
| TextRegion | `check(state, clusterInnerText)`：定位并比较正文 | `locate(state, clusterInnerText)`：相对 Cluster inner 的 outer/inner 区间 | 自身 outer |
| JsonFile | `check(state, path)`：读取、解析 JSON 并委派参与的 Region | 无 | 整个 JSON 文件文本，字段委派 JsonRegion.make 汇合 |
| JsonRegion | `check(state, json)`：检查字段路径及字段值 | `locate(state)`：JSON path，固定路径直接返回 | 期望 JSON 值，或表达“字段应不存在” |

TextCluster/TextRegion 的 `check` 复用 `locate`，检查与生成共用正文生成规则。JsonRegion 的 `locate` 只给出路径；路径是否缺失、中间容器类型是否错误，由 `check` 判定。`make` 只生成内容，不写文件。

### outer 与 inner

`outer` 是包含自身 Wrapper 的完整文本；`inner` 是自身 Wrapper 内的正文。Cluster inner 可包含 Region outer，不去除子级 Wrapper。定位成功时给出 outer、inner 两个 `[start, end)` 字符区间，下标与 JavaScript `string.slice` 一致，均相对传入的父级文本。

文本 `make(state)` 返回 outer。TextCluster 始终生成自身 Wrapper；TextRegion 按 State 中的 ManagedItem 开关决定是否包裹，未托管时 outer 与 inner 相同。生成接口只接收 State。

TextRegion 的 `check` 比较实际 inner 与预期 inner。正文是最小替换单位，读取与生成使用一致的边界约定，以字符串相等判定 `idle`，不作词法分析、语义等价分析或忽略首尾空白的比较。额外注释、语句等也只表现为与 expect 不等，Apply 会随整段替换覆盖它们。

File 和 Cluster 没有整份内容的 `outdated`，不能因一个子 Region 的问题而整文件或整 Cluster 重写。Cluster 内非受管 Region 的内容、普通自定义文本和未涉及的 JSON 字段均保持原样。

## Wrapper 与 Marker

TextCluster 和 TextRegion 一律用长期 Wrapper 定位。Wrapper 表达元素身份与边界，可按物理归属嵌套；解析相关标记时须检查配对、唯一性、顺序和嵌套关系。缺少一端、重复、交叉闭合等导致无法取得可信范围时，报告 `damaged`，不能猜测可写 span。

两者共用 Wrapper 定位协议，结果为 `located`、`missing` 或 `damaged`。只有 `located` 提供可信的 outer/inner 区间；`damaged` 可附错误位置供展示。交互验证复用此协议。

CMake/.npmrc 的标记独占一行，身份为 `cluster:<id>` 或 `region:<id>`：

```text
# arrange:begin region:<id>
正文
# arrange:end region:<id>
```

Marker 写作 `# arrange:insert region:<id>`，Cluster 同理。生成使用 LF，非空正文以换行结束；定位支持 LF/CRLF，正文仍逐字符比较。

没有 Wrapper 就是 `missing`，即使旁边似乎已有相应内容也不分析。文本 CONFIG 不识别 CMake、npmrc 等正文结构，不产生 `unwrapped-existing`、智能内容候选或 `extraneous`，也不从恢复内容反推 YAML 配置。

Marker 只在交互中标注一次性插入位置，验证后由生成的 Wrapped Content 替换。已有内容由用户直接补上正确的长期 Wrapper；损坏的 Wrapper 由用户修复。不能在损坏标记旁边再加一套，仍留下无法解析的结构。

ManagedItem 关闭的 Region 不参加定位和检查。参与元素因标记损坏无法可靠定位时，记录其实际定位问题；不为未托管内容增加管理规则。

## CONFIG 扫描矩阵

SCAN 从 ManagedItem 与配置取得 expect，沿物理归属观察 actual，委派相应定义执行 check。观察、判定和处理阶段分开：SCAN 只读和计算，不写文件、不改配置、不运行外部工具。

### 父级门控

下表仅适用于本次需要参与的对象。发生父级问题后，其依赖子项不进入扫描，也不产生子项结果；其他可独立扫描的分支继续。

| 对象 | actual | 判定/分类 | 后续扫描 |
|---|---|---|---|
| TextFile/JsonFile | 文件不存在 | `missing`/Resolvable | 后代不进入扫描 |
| TextFile/JsonFile | 无法读取，或目标实际是目录等 | `read-error`/Fatal | 后代不进入扫描 |
| TextFile | 可读取 | `present` | 扫描参与的 TextCluster |
| JsonFile | 可读取但 JSON 无法解析 | `unparsable`/Fatal | 所属 JsonRegion 不进入扫描 |
| JsonFile | 可读取且可解析 | `present` | 扫描参与的 JsonRegion |
| TextCluster | 无自身 Wrapper | `missing`/Resolvable | 所属参与 Region 不进入扫描 |
| TextCluster | Wrapper 损坏，无法可靠定位 | `damaged`/Resolvable | 所属参与 Region 不进入扫描 |
| TextCluster | Wrapper 完整、范围确定 | `located` | 扫描其中参与的 TextRegion |

Cluster 扫描报告可以包含 Region 问题；子 Region 不符合 expect，不等于 Cluster 自身损坏。若损坏波及其他区域的定位，那些区域不进入扫描。

### TextRegion

前提：父级可用、所属 ManagedItem 开启、Region 在本次范围内、expect 合法。

| expect | actual | 判定/分类 |
|---|---|---|
| 任意 | 无 Wrapper | `missing`/Resolvable |
| 任意 | Wrapper 损坏 | `damaged`/Resolvable |
| 非 null 对应的正文 | 完整 Wrapper，正文相等 | `idle` |
| 非 null 对应的正文 | 完整 Wrapper，正文不等 | `outdated`/Applicable：整段替换正文 |
| null 对应的空正文 | 完整 Wrapper，正文为空 | `idle` |
| null 对应的空正文 | 完整 Wrapper，正文非空 | `outdated`/Applicable：清空正文，保留 Wrapper |

因此 null 不免除 TextRegion 的存在要求：机器必须定位到空 Wrapper，才能确认它符合期望。

### JsonRegion

前提同上，但父级为可解析的 JsonFile，定位依据是字段路径，不使用 Wrapper。

| expect | actual | 判定/分类 |
|---|---|---|
| 非 null 值 | 字段不存在 | `missing`/Resolvable |
| 非 null 值 | 字段存在且值相等 | `idle` |
| 非 null 值 | 字段存在但值不同，包括显式 null | `outdated`/Applicable：替换字段值 |
| 字段不存在 | 字段不存在 | `idle` |
| 字段不存在 | 字段存在，包括显式 null | `outdated`/Applicable：移除字段 |
| 任意 | 访问路径的容器类型不符 | `damaged`/Resolvable |

JSON 比较解析后的值，包含类型；不比较整文件的序列化文本。对象按成员值比较，数组按顺序比较。路径中间层不存在可确认目标字段不存在；中间层类型错误则不能等同于缺失。例如 `dependencies` 为 `123` 时，无法访问 `dependencies["@arrange/framework"]`，报告该 Region damaged，要求用户编辑，不能擅自把父值替换成空对象。

### Fatal 与报告完整性

配置文件无法解析、无法产生合法 expect、参与文件读取失败、JSON 语法错误等属于 Fatal。Fatal 表示本次同步不提供恢复流程，并非 SCAN 立即停止的指令。

SCAN 记录 Fatal 后继续检查有可信输入的独立分支，阻断依赖分支。若配置无法解析，无法建立可信 State/拓扑，就记录这一原因；只能继续不依赖它的检查，不拼造配置和子项结果。拓扑本身无法建立时，记录扫描范围无法展开，而非声称检查完成。

同一 ManagedItem 跨文件时，一个文件缺失不妨碍另一文件被扫描；同一份报告中收集到的 Applicable 也不能绕过任何阻塞提前执行。

## CONFIG SCAN 的四类结果

```ts
type ConfigScope = "Global" | "UI" | "Native"

interface ConfigScanReport {
    readonly scope: ConfigScope
    readonly fatal: readonly FatalIssue[]
    readonly resolvable: readonly ResolvableIssue[]
    readonly idle: readonly IdleResult[]
    readonly applicable: readonly ApplicableUpdate[]
}
```

| 分类 | 含义 | 消费阶段 |
|---|---|---|
| Fatal | 当前 LSRA 没有恢复流程的阻塞 | RESOLVE 展示报告并失败退出 |
| Resolvable | 需交互修复、定位或创建的问题 | RESOLVE 一次处理一个 |
| Idle | 已检查且符合期望的结果 | 展示，不执行 |
| Applicable | 已确定的常规更新 | 无阻塞后 APPLY 批量执行 |

位置、expect/actual、判定和问题原因由对应的四类结果条目携带，不保存在定义上。Applicable 保存 Region 定义、确定的期望内容和本轮定位结果，并关联文件快照，供 Apply 使用。`located`/`present` 表示取得物理位置或内容，`idle` 表示检查符合期望。ManagedItem 关闭的 Region 不产生结果；父级问题导致子项不进入扫描，也不产生结果。扫描节能缓存及其跳过状态留待以后设计。

## CONFIG 与 SETUP 的 LSRA

`LSRA` 指 `LOOP { SCAN, RESOLVE } → APPLY`。

- CONFIG 管工程文件：使用上述物理模型与 ManagedItem 配置确定需要恢复和更新的内容。
- SETUP 管准备状态：结合项目需求与本机设置，确定环境、工具和相关设施是否已为开发/构建准备好；其职责不限于 local YAML。

完整 sync 顺序执行两套独立、同构的 LSRA：

```txt
CONFIG LSRA 成功 → 重新加载 ProjectState → SETUP LSRA
CONFIG 失败/放弃 → sync 结束，不进入 SETUP
```

`--config`/`--setup` 选择部分，`--ui`/`--native` 选择操作范围。“全量重扫”指当前 LSRA 的整个已选范围，不是仅重扫被修复节点。当前不设计扫描缓存。

CONFIG 每轮执行：

1. SCAN 产出尽可能完整的报告。
2. RESOLVE 先检查整个报告的 Fatal；只要存在，就展示报告并失败退出，不先修复任何 Resolvable。
3. 无 Fatal、有 Resolvable 时，处理其中一个 Issue；取消即 Abort。交互写入、用户编辑等产生副作用后，重新加载 State、推导拓扑并全量 SCAN，不再消费旧报告的其他 Issue 或更新。
4. Fatal 和 Resolvable 都为空时，RESOLVE 完成，进入 APPLY。
5. APPLY 完成后结束本部分；正常流程不再追加扫描或内容复检。开发测试可以验证结果，但不成为生产状态机的一环。

`sync --scan` 只输出所选部分的扫描报告，不 RESOLVE、不 APPLY；有 Fatal 或 Resolvable 时返回非零状态。扫描模式的 SETUP 只能观察当前状态，不能假定 CONFIG 已完成更新。SETUP 的具体检查项、分类和交互流程另行设计，本矩阵不直接套用到 SETUP。

## CONFIG 的恢复与应用

| Resolvable | 一次交互的处理 |
|---|---|
| File missing | 询问是否创建；确认后调用 File.make，写入后重扫 |
| TextCluster/TextRegion missing | 用户给已有区块补 Wrapper，或在新建位置放 Marker；验证定位，必要时用对应定义生成并写入，然后重扫 |
| TextCluster/TextRegion damaged | 展示标记错误，要求用户编辑修复或取消；继续后重扫，仍有问题则仍报告问题 |
| JsonRegion missing | 确认后按 locate 的路径写入 make 的期望值；只创建确实不存在的必要容器，写入后重扫 |
| JsonRegion damaged | 展示文件、路径、期望容器类型和实际值；要求用户编辑或取消，继续后重扫 |

定位验证只检查 Wrapper/Marker 协议及相对父级的位置，不解析正文含义。恢复已有 Cluster 时保留正文；恢复已有 Region 时保留正文建立定位，是否 outdated 交给下一轮 check。新建 Cluster 才按 State 完整生成外壳和子内容。

恢复内容不反哺配置，也不询问是否承认现状；没有独立的 PostResolve 配置订正步骤。用户若希望保留不同内容，可以自行修改 YAML 后继续，所有变化通过重载与重扫反映。

APPLY 仅使用最后一轮无阻塞报告中的 Applicable 及其定位结果，按文件汇合更新。TextRegion 的相对区间结合 Cluster inner 起点换算为文件区间，只替换 Region inner，保留 Wrapper；JsonRegion 按 JSON path 设置或移除字段。没有删除文件、Cluster、Region 或未包裹内容的 Resolve 动作；清空受管正文、移除期望不存在的 JSON 字段属于确定性更新。

## `.arrange/` 与写入失败

`.arrange/` 是本机工作目录，与 `arrange.local.yaml` 一样不提交 Git，不作为共享配置或第二份 State。它可承载事务 journal 和恢复信息，未来缓存的具体机制不在当前设计内。

首版 Apply 事务记录包括事务 ID、涉及文件、原内容 hash、预期新内容 hash、写入进度和完成状态。先组合全部待写内容，再用目标旁临时文件逐个替换并记录进度；不承诺多文件操作系统级绝对原子性。

写入前核对报告基于的文件内容，避免使用已失效的 span；发现外部修改或写入失败时终止本次 Apply，保留恢复信息。恢复时，原内容表示尚未写入，预期内容表示已写入，二者都不是则交给用户处理。这些写入保护不构成 Apply 后的常规复检循环。

## 共用边界

create、adopt、sync 以及后续命令复用同一套定义和生成链。创建所需的未托管初始内容，不意味着后续 CONFIG 有权扫描或更新它。SETUP 的具体 LSRA 另行设计；本模型不规定工具探测、安装或 configure 对策。
