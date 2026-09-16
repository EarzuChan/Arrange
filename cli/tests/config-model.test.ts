import assert from "node:assert/strict"
import {test} from "node:test"
import {Wrapper} from "../src/managed/Wrapper.ts"
import {TextRegion} from "../src/managed/TextRegion.ts"
import {JsonRegion, readJsonPath, setJsonPath, type JsonValue, type JsonExpected} from "../src/managed/JsonRegion.ts"
import {registryRegion, registryCluster} from "../src/node-js/NodeJsFiles.ts"
import {managedItemIds} from "../src/managed/ManagedItem.ts"
import {projectDefinitionSchema} from "../src/project/ProjectState.ts"
import {stateFor} from "./fixture.ts"

const state = stateFor("unused")

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
        readonly managedItemId = managedItemIds.registry
        protected override makeInner(): string { return "value\n" }
    }()
    assert.equal(region.check(state, region.wrapper.make("value\n")).kind, "Idle")
    for (const body of ["value \n", "\nvalue\n", "value\n# 注释\n", "value\r\n"]) assert.equal(region.check(state, region.wrapper.make(body)).kind, "Applicable")
})

for (const [label, expected, json, kind, cause] of [
    ["有值而缺失", "1", {}, "Resolvable", "missing"],
    ["相等", "1", {dependencies: {test: "1"}}, "Idle", undefined],
    ["类型不同", "1", {dependencies: {test: 1}}, "Applicable", "outdated"],
    ["值不同", "1", {dependencies: {test: "2"}}, "Applicable", "outdated"],
    ["不存在且缺失", undefined, {}, "Idle", undefined],
    ["不存在但显式 null", undefined, {dependencies: {test: null}}, "Applicable", "outdated"],
    ["配置 null 期望字段不存在", null, {dependencies: {test: null}}, "Applicable", "outdated"],
    ["中间容器损坏", undefined, {dependencies: 123}, "Resolvable", "damaged"],
] as const) {
    test(`JSON 矩阵：${label}`, () => {
        const region = new class extends JsonRegion {
            readonly id = "test"
            readonly managedItemId = managedItemIds.registry
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
        readonly managedItemId = managedItemIds.registry
        protected readonly path = ["value"]
        protected override makeValue(): JsonValue { return {a: 1, b: [2, 3]} }
    }()
    assert.equal(region.check(state, {value: {b: [2, 3], a: 1}}).kind, "Idle")
    assert.equal(region.check(state, {value: {b: [3, 2], a: 1}}).kind, "Applicable")
    const json: JsonValue = {other: 7}
    setJsonPath(json, ["dependencies", "test"], "1")
    setJsonPath(json, ["dependencies", "test"], undefined)
    assert.deepEqual(json, {other: 7, dependencies: {}})
    assert.throws(() => setJsonPath({dependencies: 123}, ["dependencies", "test"], "1"))
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
        readonly managedItemId = managedItemIds.registry
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
