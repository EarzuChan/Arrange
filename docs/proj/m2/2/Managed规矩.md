本文规定 Arrange CLI 对 managed item 的语义、检查、修复、create / adopt / sync 之间的分工。

核心目标：

1. 语义确定。
2. 行为可解释。
3. sync 可幂等。
4. 不静默接管用户未托管内容。
5. `arrange.project.yaml` 只保存托管开关，不保存 managed item 的内部能力描述。

---

# 1. 根原则

`arrange.project.yaml` 中只保存：

```yaml
managed-items:
  - some.item.key
```

也就是说，工程配置只表达：

```txt
列表中的 item 当前由 Arrange 持续托管；不在列表中就是 managed=false。
```

以下信息不进入 yaml，而是 CLI 内部确定性定义：

- item key。
- item 所属领域。
- item 承载文件。
- item 是否支持 managed wrapper。
- item 目标值从 `ProjectState` 哪里取得。
- item 目标值是否可缺省。
- item 如何检查。
- item 如何生成。
- item 如何修复。

---

# 2. create / adopt / sync 的职责边界

## 2.1 create

create 是“尚无 Arrange 标准工程，正在全新创建工程”。

create 负责：

- 接收用户输入。
- 建立初始 `ProjectState`。
- 生成初始文件。
- 按用户选择写入 managed 开关。

create 不负责：

- 对已有工程进行接管判断。
- 执行 sync 检查。
- 推断用户现存文件是否应托管。

create 阶段，若某 item 值已设置：

| managed | 值是否设置 | create 行为 |
|---|---|---|
| true | 是 | 生成 managed 形态。 |
| false | 是 | 生成 one-shot 普通形态。 |
| true | 否 | 不生成。未来 sync 在值被设置后处理。 |
| false | 否 | 不生成。 |

## 2.2 adopt

adopt 是“尚无 Arrange 标准工程，正在结合已有 raw 工程一次性创建 Arrange 工程”。

adopt 负责：

- 扫描已有 native / ui 文件。
- 识别可托管特征。
- 从现场发掘配置线索。
- 让用户决定哪些内容转为 managed。
- 建立初始 `ProjectState`。

adopt 与 sync 的关键区别：

```txt
adopt 可以从 raw 现场提取值，形成 yaml 事实源。
sync 不应把本地现场反向采纳为 yaml 事实源。
```

## 2.3 sync

sync 是“已有 Arrange 标准工程的持续管理过程”。

sync 的事实源是：

```txt
arrange.project.yaml + arrange.local.yaml
```

sync 负责：

- 检查 managed item 与 yaml 是否一致。
- 检查 local/toolchain/configure ready 状态。
- 在 perform 阶段把工程推进到 yaml 声明的目标状态。

sync 不负责：

- 静默接管未托管内容。
- 从本地混乱写法反向推断 yaml。
- 在 managed=false 时清理或修改现场。

---

# 3. 通用概念

## 3.1 当前托管开关

```txt
managed=true
managed=false
```

它来自 `project["managed-items"].includes(key)`。

## 3.2 目标值状态

每个 item 根据 `ProjectState` 计算目标值。

| 状态 | 含义 |
|---|---|
| `D-present` | 有明确目标值。 |
| `D-default` | 该 item 可缺省，当前处于默认态。 |
| `D-invalid` | 该 item 不可缺省，但 yaml 缺少必要值。 |

例子：

- `framework.version`：不可缺省。
- `node.package-json.framework-dependency`：不可缺省，目标值来自 `framework.version`。
- `node.npmrc.arrange-registry`：可缺省，目标值来自 `framework.nodeRegistryUrl`。
- `cmake.fetch-content`：block 本身不可缺省；其中 `cmakeFetchContentUrl` 可缺省，缺省时使用 CLI 内部默认 Git URL，版本仍来自 `framework.version`。

## 3.3 wrapper-capable 现场状态

适用于 CMake managed region、`.npmrc` managed region。

| 状态 | 含义 |
|---|---|
| `M-ok` | 有 managed wrapper，内容正确。 |
| `M-outdated` | 有 managed wrapper，但内容与目标不一致。 |
| `M-damaged` | 有 managed wrapper，但 marker / 内容损坏，无法可靠处理。 |
| `U-same` | 有未包裹内容，且与期待值完全相等。 |
| `U-different` | 有未包裹内容，且与目标值冲突：我感觉无法判断，因为内容非生成的，可能性太多样。 |
| `N` | 目标内容不存在。 |
| `X` | 承载文件不可解析，或现场结构无法可靠判断。 |

## 3.4 JSON 现场状态

JSON 没有 wrapper。对 JSON item 来说：

```txt
managed=true 本身就是 ownership 事实。
```

| 状态 | 含义 |
|---|---|
| `E-same` | 字段存在，值正确。 |
| `E-different` | 字段存在，值不同。 |
| `N` | 字段不存在。 |
| `X` | JSON 不可解析。 |

---

# 4. 写文件确认原则

sync perform 阶段按风险分级。

| 操作 | 是否需要确认 |
|---|---|
| 更新已归 Arrange 所有的 managed wrapper 内容 | 不需要确认，自动执行，打印 diff / summary。 |
| 更新 JSON 中已由 yaml 声明 managed=true 的字段 | 不需要确认，自动执行，打印 diff / summary。 |
| 新增内容 | 需要确认。 |
| 删除内容 | 需要确认。 |
| wrapper-capable 的 unwrapped 内容转 managed | 必须交互。 |
| wrapper-capable 的 unwrapped 内容被替换为 yaml 目标 | 必须交互。 |
| managed=false 的 item | 不检查、不修复、不清理。 |

---

# 5. wrapper-capable item 规则矩阵

适用 item：

- `cmake.fetch-content`
- `cmake.plugin-target`
- `cmake.link-framework`
- `node.npmrc.arrange-registry`

## 5.1 `managed=true`

### 5.1.1 `D-invalid`

| 现场 | check | perform |
|---|---|---|
| 任意 | `config-invalid` | 本 item 不继续检查。sync check 报错；sync perform 前应失败。前期直接要求用户修 yaml 后重新 sync。 |

### 5.1.2 `D-present`

| 现场 | check | perform |
|---|---|---|
| `M-ok` | `ok` | 不动。 |
| `M-outdated` | `outdated` | 自动更新 managed wrapper 内容，打印 diff / summary。 |
| `M-damaged` | `damaged` | 进入交互式修复；不能自动乱改。 |
| `U-same` | `unwrapped-existing` | 必须交互。可选择包裹为 managed、关闭 managed、取消 sync。不能静默接管。 |
| `U-different` | `conflict` | 必须交互。可选择用 yaml 目标生成标准 managed 内容、关闭 managed、取消 sync。sync 不应采纳现场值写回 yaml。 |
| `N` | `missing` | 新增 managed 内容。新增前必须确认。 |
| `X` | `damaged` | 进入交互式修复或报错。 |

### 5.1.3 `D-default`

`D-default` 表示该 item 目标值处于默认态。默认态不是错误。

| 现场 | check | perform |
|---|---|---|
| `M-ok` / `M-outdated` | `extraneous` | 目标是不存在该 managed 内容。删除前必须确认；不删除则可关闭 managed 或取消 sync。 |
| `M-damaged` | `damaged` | 进入交互式修复；不能自动乱删。 |
| `U-same` / `U-different` | `unmanaged-existing` | 必须交互。可选择删除现场值、关闭 managed、取消 sync。sync 不应采纳现场值写回 yaml。 |
| `N` | `ok` | 不动。 |
| `X` | `damaged` | 进入交互式修复或报错。 |

## 5.2 `managed=false`

| 现场 | check | perform |
|---|---|---|
| 任意 | `disabled` | 不检查、不修复、不删除、不拆 wrapper。 |

解释：

```txt
managed=false 的语义是 Arrange 不管理该 item。
```

即使现场还残留 managed wrapper，也不在普通 sync 中拆掉。这样用户临时关闭 managed 后，未来重新打开 managed 时仍可保持上下文，不必重新接管。

若未来需要清理 disabled wrapper，应设计为独立显式操作，而不是普通 sync 的隐式副作用。

---

# 6. JSON item 规则矩阵

适用 item：

- `node.package-json.framework-dependency`

JSON 没有 managed wrapper，因此：

```txt
managed=true 即视为 Arrange 拥有该字段。
```

这保证 sync 幂等。

## 6.1 `managed=true`

### 6.1.1 `D-invalid`

| 现场 | check | perform |
|---|---|---|
| 任意 | `config-invalid` | 本 item 不继续检查。sync check 报错；sync perform 前应失败。前期直接要求用户修 yaml 后重新 sync。 |

### 6.1.2 `D-present`

| 现场 | check | perform |
|---|---|---|
| `E-same` | `ok` | 不动。 |
| `E-different` | `outdated` | 自动更新字段，打印 diff / summary。 |
| `N` | `missing` | 新增字段。新增前必须确认。 |
| `X` | `damaged` | 报错或进入交互式修复。 |

JSON item 不做“首次接管确认”。原因：

```txt
JSON 没有 wrapper，也没有额外 ownership marker。
若每次都询问，则 sync 不幂等。
因此 project yaml 的 managed=true 就是该字段的 ownership 事实。
```

但所有变更仍必须打印清晰 diff / summary。

## 6.2 `managed=false`

| 现场 | check | perform |
|---|---|---|
| 任意 | `disabled` | 不检查、不修复、不删除。 |

---

# 7. `.npmrc` 特例

`node.npmrc.arrange-registry` 的目标值来自：

```txt
project.framework.nodeRegistryUrl
```

它具有三个特殊性：

1. `.npmrc` 文件可能不存在。
2. `nodeRegistryUrl` 可缺省。
3. `.npmrc` 支持 Arrange managed wrapper，但用户也可能有其它 npm 配置。

Arrange 只管理：

```ini
@arrange:registry=...
```

不管理整个 `.npmrc`。

## 7.1 `managed=true + nodeRegistryUrl 已设置`

即 `D-present`。

| 现场 | check | perform |
|---|---|---|
| 文件不存在 | `missing` | 创建 `.npmrc` 并写入 managed block。新增前必须确认。 |
| 文件存在，`M-ok` | `ok` | 不动。 |
| 文件存在，`M-outdated` | `outdated` | 自动更新 managed block，打印 diff / summary。 |
| 文件存在，`M-damaged` | `damaged` | 交互式修复或报错。 |
| 文件存在，`U-same` | `unwrapped-existing` | 必须交互。可包裹为 managed、关闭 managed、取消 sync。 |
| 文件存在，`U-different` | `conflict` | 必须交互。可用 yaml 目标替换为标准 managed block、关闭 managed、取消 sync。 |
| 文件存在，`N` | `missing` | 插入 managed block。新增前必须确认。 |

## 7.2 `managed=true + nodeRegistryUrl 未设置`

即 `D-default`。目标状态是：

```txt
不设置 @arrange:registry，使用默认 npm registry。
```

| 现场 | check | perform |
|---|---|---|
| 文件不存在 | `ok` | 不动。 |
| 文件存在但无 `@arrange:registry` | `ok` | 不动。 |
| 文件存在，`M-ok` / `M-outdated` | `extraneous` | 删除 managed block 前必须确认；不删除则关闭 managed 或取消 sync。 |
| 文件存在，`M-damaged` | `damaged` | 交互式修复或报错。 |
| 文件存在，`U-same` / `U-different` | `unmanaged-existing` | 必须交互。可删除该行、关闭 managed、取消 sync。不能采纳现场值写回 yaml。 |

## 7.3 `managed=false`

| 现场 | check | perform |
|---|---|---|
| 任意 | `disabled` | 不检查、不修复、不删除、不拆 wrapper。 |

---

# 8. CMake item 特例

CMake item 是 wrapper-capable。

常见 item：

- `cmake.fetch-content`
- `cmake.plugin-target`
- `cmake.link-framework`

CMake 承载文件通常是：

```txt
native/CMakeLists.txt
```

如果承载文件不存在：

| managed | desired | check | perform |
|---|---|---|---|
| true | `D-present` | `carrier-missing` / `missing` | 新建或修复 CMakeLists。新增前必须确认。 |
| true | `D-default` | 视 item 具体语义而定 | 若目标为无内容则 ok；否则按缺失处理。 |
| false | 任意 | `disabled` | 不动。 |

`cmake.fetch-content` 中：

```txt
GIT_TAG = v${framework.version}
GIT_REPOSITORY = framework.cmakeFetchContentUrl ?? CLI 默认 Git URL
```

CMake 不独立决定 Arrange 版本。

---

# 9. adopt 中的接管与信息发掘

adopt 不是 sync。

adopt 在处理 raw 工程时，需要同时做两件事：

1. 识别现场是否已有可托管内容。
2. 从现场提取可能的工程信息。

例如：

- 从 package.json 中发现 `@arrange/framework` 版本。
- 从 `.npmrc` 中发现 `@arrange:registry`。
- 从 CMake FetchContent 中发现 Arrange Git URL / tag。
- 从 `juce_add_plugin` 中发现 plugin name、version、vendor、products 等。

adopt 可以把这些信息作为候选事实源，让用户确认后写入 yaml。

但 adopt 不能粗暴覆盖现场。对每个可托管特征：

| 现场 | adopt 行为 |
|---|---|
| 已有 managed wrapper | 建议 managed=true，并尝试读取值。 |
| 有 unwrapped 内容 | 询问是否接管。接管则包裹 / 标记 managed；不接管则 managed=false。 |
| 内容冲突 | 汇总冲突，让用户决定最终 yaml 值，并要求现场修复到一致。 |
| 缺失 | 根据用户选择生成或保持缺失。 |

adopt 的“采纳现场值”是合法的，因为 adopt 发生在 Arrange 标准工程建立之前。

sync 的“采纳现场值”默认不合法，因为 sync 发生在 Arrange 标准工程建立之后。

---

# 10. check report 与 perform 的关系

sync check 只生成报告，不写文件。

报告至少需要能表达：

```txt
ok
disabled
missing
outdated
extraneous
unwrapped-existing
unmanaged-existing
conflict
damaged
config-invalid
carrier-missing
```

sync perform 必须基于 check report 执行。

原则：

1. `config-invalid` 是前置致命问题。
2. `disabled` 不进入修复。
3. deterministic 且已归 Arrange 所有的更新可自动执行。
4. 新增必须确认。
5. 删除必须确认。
6. unwrapped / unmanaged 现场内容转 managed 必须交互。
7. 用户取消交互时，sync perform 失败，不应伪装成功。

---

# 11. 幂等性说明

本规则保证幂等性的方式：

1. `managed=false` 完全不碰现场。
2. wrapper-capable item 以 managed wrapper 作为 ownership 证据。
3. JSON item 以 yaml 中 `managed=true` 作为 ownership 证据。
4. 已归 Arrange 所有的内容更新后，再次 check 应为 `ok`。
5. 需要用户确认的新增 / 删除 / 接管行为完成后，再次 check 应为 `ok` 或 `disabled`。
6. 用户取消时，sync 不宣称成功。

因此：

```txt
同一份 yaml + 同一份已修复现场
重复执行 sync
不应产生新的无意义变更或重复询问。
```
