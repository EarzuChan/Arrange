import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile, rm } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { configRegistry, createConfigRegistry } from "../src/config/ConfigRegistry.ts"
import { Wrapper } from "../src/managed/Wrapper.ts"
import { TextFile, JsonFile } from "../src/managed/ManagedFile.ts"
import { TextCluster } from "../src/managed/TextCluster.ts"
import { TextRegion } from "../src/managed/TextRegion.ts"
import { JsonRegion, readJsonPath, setJsonPath, type JsonValue, type JsonExpected } from "../src/managed/JsonRegion.ts"
import { registryRegion, registryCluster } from "../src/node-js/NodeJsStuffs.ts"

import { projectDefinitionSchema } from "../src/project/ProjectState.ts"
import { fixture, stateFor, write } from "./fixture.ts"
import { pluginVersionRegion } from "../src/cmake/CmakeStuffs.ts"
import { ConfigScanner } from "../src/sync/ConfigScanner.ts"

const state = stateFor("unused")
const registry = configRegistry.items.find(item => item.id === registryRegion.managedItemId)!

test("JUCE 插件版本使用 SemVer 数字核心，共享版本保留预发布与构建信息", () => {
    const project = stateFor("unused")
    project.project.project.version = "1.2.3-beta.4+local.7"
    assert.match(pluginVersionRegion.make(project), /VERSION "1\.2\.3"/)
    assert.equal(project.project.project.version, "1.2.3-beta.4+local.7")
})

test("文本位置是父级相对的 outer/inner，支持嵌套、中文及 CRLF", () => {
    const text = `前缀🙂\n${registryCluster.make(state)}后缀\n`
    const cluster = registryCluster.locate(state, text)
    assert.equal(cluster.kind, "located")
    if (cluster.kind !== "located") return
    assert.equal(text.slice(cluster.outer.start, cluster.outer.end), registryCluster.make(state))
    const body = text.slice(cluster.inner.start, cluster.inner.end)
    const region = registryRegion.locate(state, body)
    assert.equal(region.kind, "located")
    if (region.kind !== "located") return
    assert.equal(body.slice(region.outer.start, region.outer.end), registryRegion.make(state))
    assert.equal(body.slice(region.inner.start, region.inner.end), "")
    const crlf = text.replace(/\n/g, "\r\n")
    assert.equal(registryCluster.locate(state, crlf).kind, "located")
})

test("Wrapper 缺端、重复、反序、交叉闭合均不提供可写区间", () => {
    const a = new Wrapper("region:a")
    const b = new Wrapper("region:b")
    for (const text of [`${a.begin}\n`, `${a.end}\n`, a.make("") + a.make(""), `${a.end}\n${a.begin}\n`, `${a.begin}\n${b.begin}\n${a.end}\n${b.end}\n`]) {
        const result = a.locate(text)
        assert.equal(result.kind, "damaged", text)
        assert.equal("inner" in result, false)
    }
    assert.equal(a.locate("裸正文").kind, "missing")
})

test("子 Region 缺端不冒充父 Cluster 损坏，独立相邻 Region 仍可检查", () => {
    const cluster = new Wrapper("cluster:test")
    const bad = new Wrapper("region:bad")
    const good = new Wrapper("region:good")
    const body = `${bad.begin}\n坏内容\n${good.make("正确\n")}`
    assert.equal(cluster.locate(cluster.make(body)).kind, "located")
    assert.equal(bad.locate(body).kind, "damaged")
    assert.equal(good.locate(body).kind, "located")
})

for (const value of [undefined, null, "", "https://registry.example"]) {
    test(`optional 文本值 ${String(value)} 的 missing/idle/outdated 与生成`, () => {
        const input = stateFor("unused")
        input.project.framework.nodeRegistryUrl = value
        const expected = value == null ? "" : `@arrange:registry=${value}\n`
        assert.equal(registryRegion.check(input, "").kind, "Resolvable")
        assert.equal(registryRegion.check(input, registryRegion.make(input)).kind, "Idle")
        const result = registryRegion.check(input, registryRegion.wrapper.make("自定义\n"))
        assert.equal(result.kind, "Applicable")
        if (result.kind === "Applicable") assert.equal(result.expected, expected)
        input.project["managed-items"] = []
        assert.equal(registryRegion.make(input), expected)
        assert.equal(registryCluster.make(input), registryCluster.wrapper.make(expected))
    })
}

test("受管正文逐字符比较，不 trim，不解析语义", () => {
    const region = new class extends TextRegion {
        readonly id = "test"
        readonly managedItemId = registry.id
        protected override makeInner(): string { return "value\n" }
    }()
    assert.equal(region.check(state, region.wrapper.make("value\n")).kind, "Idle")
    for (const body of ["value \n", "\nvalue\n", "value\n# 注释\n", "value\r\n"]) assert.equal(region.check(state, region.wrapper.make(body)).kind, "Applicable")
})

for (const [label, expected, json, kind, cause] of [
    ["有值而缺失", "1", {}, "Resolvable", "missing"],
    ["相等", "1", { dependencies: { test: "1" } }, "Idle", undefined],
    ["类型不同", "1", { dependencies: { test: 1 } }, "Applicable", "outdated"],
    ["值不同", "1", { dependencies: { test: "2" } }, "Applicable", "outdated"],
    ["不存在且缺失", undefined, {}, "Idle", undefined],
    ["不存在但显式 null", undefined, { dependencies: { test: null } }, "Applicable", "outdated"],
    ["配置 null 期望字段不存在", null, { dependencies: { test: null } }, "Applicable", "outdated"],
    ["中间容器损坏", undefined, { dependencies: 123 }, "Resolvable", "damaged"],
] as const) {
    test(`JSON 矩阵：${label}`, () => {
        const region = new class extends JsonRegion {
            readonly id = "test"
            readonly managedItemId = registry.id
            protected readonly path = ["dependencies", "test"]
            protected override makeValue(): JsonExpected { return expected }
        }()
        assert.deepEqual(region.locate(state), ["dependencies", "test"])
        const result = region.check(state, json)
        assert.equal(result.kind, kind)
        assert.equal("cause" in result ? result.cause : undefined, cause)
    })
}

test("JSON 值比较尊重对象成员、数组顺序，更新保持兄弟字段和原型安全", () => {
    const region = new class extends JsonRegion {
        readonly id = "test"
        readonly managedItemId = registry.id
        protected readonly path = ["value"]
        protected override makeValue(): JsonValue { return { a: 1, b: [2, 3] } }
    }()
    assert.equal(region.check(state, { value: { b: [2, 3], a: 1 } }).kind, "Idle")
    assert.equal(region.check(state, { value: { b: [3, 2], a: 1 } }).kind, "Applicable")
    const json: JsonValue = { other: 7 }
    setJsonPath(json, ["dependencies", "test"], "1")
    setJsonPath(json, ["dependencies", "test"], undefined)
    assert.deepEqual(json, { other: 7, dependencies: {} })
    assert.throws(() => setJsonPath({ dependencies: 123 }, ["dependencies", "test"], "1"))
    setJsonPath(json, ["__proto__", "test"], "safe")
    assert.equal(readJsonPath(json, ["__proto__", "test"]), "safe")
    assert.equal(({} as Record<string, unknown>).test, undefined)
})

test("非法配置不能生成期望，null 不被误作空字符串", () => {
    for (const value of [null, undefined, ""]) {
        const input = stateFor("unused").project
        input.framework.nodeRegistryUrl = value
        assert.equal(projectDefinitionSchema.parse(input).framework.nodeRegistryUrl, value)
    }
    const region = new class extends TextRegion {
        readonly id = "invalid"
        readonly managedItemId = registry.id
        protected override makeInner(): string { throw new Error("坏配置") }
    }()
    assert.equal(region.check(state, "").kind, "Fatal")
})


test("同级 Wrapper 嵌套不得提供可重叠的更新区间", () => {
    const a = new Wrapper("region:a")
    const b = new Wrapper("region:b")
    const text = a.make(b.make("body\n"))
    assert.equal(a.locate(text).kind, "damaged")
    assert.equal(b.locate(text).kind, "damaged")
})

function definitions() {
    const region = new class extends TextRegion {
        readonly id = "test.value"
        readonly managedItemId = "test.setting"
        checks = 0
        protected override makeInner(): string { return "new\n" }
        override check(state: Parameters<TextRegion["check"]>[0], inner: string) {
            this.checks++
            return super.check(state, inner)
        }
    }()
    const cluster = new class extends TextCluster {
        readonly id = "test.cluster"
        readonly regions = [region]
        protected override makeInner(input: typeof state): string { return region.make(input) }
    }()
    const file = new class extends TextFile {
        readonly id = "test.file"
        readonly scope = "UI"
        readonly clusters = [cluster]
        override path(input: typeof state): string { return resolve(input.rootDir, "owned.txt") }
        override make(input: typeof state): string { return cluster.make(input) }
    }()
    return { file, cluster, region, metadata: [{ id: region.managedItemId, label: "测试配置" }] }
}

test("File 与 Cluster 纯自检不调用子级，父结构有效时子级仍可独立报损坏", () => {
    const { file, cluster, region } = definitions()
    const input = stateFor("不存在的路径")
    input.project["managed-items"] = [region.managedItemId]
    const text = cluster.wrapper.make(`${region.wrapper.begin}\n损坏子级\n`)
    assert.deepEqual(file.check(input, null), { kind: "Resolvable", cause: "missing", message: "文件不存在" })
    assert.deepEqual(file.check(input, text), { kind: "Idle", value: text })
    const parent = cluster.check(input, text)
    assert.equal(parent.kind, "Idle")
    assert.equal("regions" in parent, false)
    assert.equal(region.checks, 0)
    if (parent.kind !== "Idle") return
    assert.equal(region.check(input, text.slice(parent.location.inner.start, parent.location.inner.end)).kind, "Resolvable")
    assert.equal(region.checks, 1)
    assert.equal(cluster.check(input, "没有父级 Wrapper").kind, "Resolvable")
    assert.equal(region.checks, 1)
})

test("JsonFile 只解析自身，合法 JSON 中缺失字段由 JsonRegion 独立检查", () => {
    let checks = 0
    const region = new class extends JsonRegion {
        readonly id = "test.json"
        readonly managedItemId = "test.setting"
        protected readonly path = ["value"]
        protected override makeValue(): JsonExpected { return "desired" }
        override check(input: typeof state, json: JsonValue) {
            checks++
            return super.check(input, json)
        }
    }()
    const file = new class extends JsonFile {
        readonly id = "test.json-file"
        readonly scope = "UI"
        readonly regions = [region]
        override path(): string { return "从未读取的文件.json" }
        protected override makeContent(): JsonValue { return {} }
    }()
    assert.equal(file.check(state, null).kind, "Resolvable")
    assert.equal(file.check(state, "{").kind, "Fatal")
    const parsed = file.check(state, "{}")
    assert.deepEqual(parsed, { kind: "Idle", value: {} })
    assert.equal(checks, 0)
    if (parsed.kind !== "Idle") return
    assert.equal(region.check(state, parsed.value).kind, "Resolvable")
    assert.equal(checks, 1)
})

test("注册只声明物理树和逻辑元数据，关联自动派生且错误在注册时拒绝", () => {
    const { file, cluster, region, metadata } = definitions()
    const registered = createConfigRegistry([file], metadata)
    assert.deepEqual(registered.items, [{ ...metadata[0], regions: [region] }])
    assert.deepEqual(registered.files, [file])
    const projectName = configRegistry.items.find(item => item.id === "project.name")!
    assert.deepEqual(projectName.regions.map(region => region.kind).sort(), ["json-region", "text-region"])
    assert.throws(() => createConfigRegistry([file, file], metadata), /File 重复/)
    assert.throws(() => createConfigRegistry([file], [...metadata, ...metadata]), /ManagedItem 重复/)
    assert.throws(() => createConfigRegistry([file], []), /未知 ManagedItem/)
    assert.throws(() => createConfigRegistry([], metadata), /缺少物理 Region/)
    const other = new class extends TextFile {
        readonly id = "other"
        readonly scope = "Native"
        readonly clusters = [cluster]
        override path(): string { return "other.txt" }
        override make(input: typeof state): string { return cluster.make(input) }
    }()
    assert.throws(() => createConfigRegistry([file, other], metadata), /Region 物理归属冲突/)
})

test("Scanner 使用一次读取的共享快照与绝对坐标，父级缺失时不检查子 Region", async t => {
    const input = await fixture(t, false)
    const { file, cluster, region, metadata } = definitions()
    input.project["managed-items"] = [region.managedItemId]
    const scanner = new ConfigScanner(createConfigRegistry([file], metadata))
    await write(file.path(input), "没有 Cluster\n")
    assert.equal((await scanner.scan(input, "UI")).resolvable.length, 1)
    assert.equal(region.checks, 0)
    const original = `前缀🙂\r\n${cluster.wrapper.make(region.wrapper.make("old\n"))}`
    await write(file.path(input), original)
    const check = cluster.check.bind(cluster)
    cluster.check = (state, text) => {
        writeFileSync(file.path(state), "并发修改的新内容\n")
        return check(state, text)
    }
    const report = await scanner.scan(input, "UI")
    assert.equal(report.applicable.length, 1)
    assert.equal(region.checks, 1)
    const update = report.applicable[0]
    assert.equal(update.target.snapshot.content, original)
    for (const idle of report.idle) assert.equal(idle.target.snapshot, update.target.snapshot)
    assert.equal(update.kind, "text")
    if (update.kind === "text") assert.equal(original.slice(update.span.start, update.span.end), "old\n")
    assert.equal(await readFile(file.path(input), "utf8"), "并发修改的新内容\n")
    await rm(file.path(input))
    assert.equal((await scanner.scan(input, "UI")).resolvable.length, 1)
    assert.equal(region.checks, 1)
})
