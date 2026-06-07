# Managed Items 与 Regions

本文记录当前确定的 managed item、管理簇与 region 设计。

原则：

- `arrange.project.yaml` 只写 managed item key。
- region 是 CLI 内部落盘细节，不进入 yaml。
- 一个 managed item 可以有多个 region。
- 一个管理簇负责识别某类物理结构，并向 managed item 暴露可读写 region。
- 物理空间连续的内容应合并为一个 region，不要拆成多段无意义 wrapper。
- create 可 one-shot 生成非 managed 内容；sync 只持续管理 managed item。

---

# 1. 管理簇

## 1.1 CMake 管理簇

| 簇 | 识别对象 |
|---|---|
| `CmakeFetchContentCluster` | `include(FetchContent)`、`FetchContent_Declare(arrange ...)`、`FetchContent_MakeAvailable(arrange)` |
| `CmakeProjectCluster` | `project(...)` |
| `CmakeJuceAddPluginCluster` | `juce_add_plugin(...)` 内部参数 |
| `CmakeTargetSourcesCluster` | `target_sources(...)` |
| `CmakeTargetLinkLibrariesCluster` | `target_link_libraries(...)` |
| `CmakeCompileDefinitionsCluster` | `target_compile_definitions(...)` |

## 1.2 JSON：不需要管理簇

Json是靠直接解析，item能和Json中的成员一一对应地找到，所以不需要簇。簇是面向难以AST解析，但大体有章法的文本数据的。

## 1.3 npmrc 管理簇

| 簇 | 识别对象 |
|---|---|
| `NpmrcArrangeRegistryCluster` | `.npmrc` 中的 `@arrange:registry=...` |

---

# 2. CMake managed items

## 2.1 `cmake.fetch-content`

来源：

```txt
framework.version
framework.cmakeFetchContentUrl ?? CLI 默认 Git URL
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.fetch-content` | `CmakeFetchContentCluster` | `include(FetchContent)`<br>`FetchContent_Declare(arrange`<br>`  GIT_REPOSITORY https://github.com/EarzuChan/Arrange.git`<br>`  GIT_TAG v1.1.1`<br>`)`<br>`FetchContent_MakeAvailable(arrange)` |

说明：

- 这是 Arrange framework native 接入块。
- 当前按连续整块管理。
- CMake 不独立决定 Arrange 版本，始终使用 `framework.version`。

---

## 2.2 `cmake.plugin-formats`

来源：

```txt
project.products
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.plugin-formats` | `CmakeJuceAddPluginCluster` | `FORMATS Standalone VST3` |

说明：

- 替代旧的粗粒度 `cmake.plugin-target`。
- 只管理 JUCE plugin 的 `FORMATS` 行。

---

## 2.3 `cmake.plugin-version`

来源：

```txt
project.version
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.plugin-version` | `CmakeJuceAddPluginCluster` | `VERSION 1.1.1` |

---

## 2.4 `cmake.plugin-identity`

来源：

```txt
project.vendorName
project.vendorCode
project.pluginCode
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.plugin-identity` | `CmakeJuceAddPluginCluster` | `COMPANY_NAME "maa"`<br>`PLUGIN_MANUFACTURER_CODE aaaa`<br>`PLUGIN_CODE aaaa` |

说明：

- 这三行物理空间连续，合作为一个 region。

---

## 2.5 `cmake.product-name`

来源：

```txt
project.name
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.product-name` | `CmakeJuceAddPluginCluster` | `PRODUCT_NAME "a"` |

说明：

- 这是 JUCE 产品名，不等同于 CMake target name。
- 不与 `cmake.name` 合并。

---

## 2.6 `cmake.name`

来源：

```txt
project.name
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `cmake.name:project` | `CmakeProjectCluster` | `project(a LANGUAGES C CXX)` |
| `cmake.name:add-plugin-target` | `CmakeJuceAddPluginCluster` | `a` |
| `cmake.name:juce-header` | `CmakeJuceAddPluginCluster` | `juce_generate_juce_header(a)` |
| `cmake.name:target-sources` | `CmakeTargetSourcesCluster` | `target_sources(a PRIVATE` |
| `cmake.name:framework-link-target` | `CmakeTargetLinkLibrariesCluster` | `target_link_libraries(a PRIVATE` |
| `cmake.name:compile-definitions-private` | `CmakeCompileDefinitionsCluster` | `target_compile_definitions(a PRIVATE` |
| `cmake.name:compile-definitions-public` | `CmakeCompileDefinitionsCluster` | `target_compile_definitions(a PUBLIC` |

说明：

- `cmake.name` 是一个联动 item。
- managed 时必须原子管理多个 region，避免改一处不改另一处造成撕裂。
- 这是高风险 item，可晚于第一批实现。

---

# 3. NODE managed items

## 3.1 `node.package-json.framework-dependency`

来源：

```txt
framework.version
```

Regions：

| region |  内容示例 |
|---|----|
| `node.package-json.framework-dependency` | `"@arrange/framework": "1.1.1"` |

说明：

- JSON 没 wrapper。
- `managed-items` 中包含该 item，即视为 Arrange 拥有该字段。

---

## 3.2 `node.package-json.name`

来源：

```txt
project.name -> packageName(project.name)
```

Regions：

| region                   | 内容示例          |
|--------------------------|---------------|
| `node.package-json.name` | `"name": "a"` |

说明：

- 这是 Node package name。
- 和 `cmake.name` 分开管理，虽然源头同为 `project.name`。

---

## 3.3 `node.npmrc.arrange-registry`

来源：

```txt
framework.nodeRegistryUrl
```

Regions：

| region | 簇 | 内容示例 |
|---|---|---|
| `node.npmrc.arrange-registry` | `NpmrcArrangeRegistryCluster` | `@arrange:registry=https://registry.example.com` |

说明：

- 该 item 可缺省。
- `framework.nodeRegistryUrl` 未设置时，目标态是不存在 `@arrange:registry`，即使用默认 npm registry。
- Arrange 只管理 `@arrange:registry` 这一项，不管理整个 `.npmrc`。