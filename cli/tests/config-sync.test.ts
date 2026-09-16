import assert from "node:assert/strict"
import {afterEach, beforeEach, mock, test} from "node:test"
import {readFile, readdir, rm, mkdir} from "node:fs/promises"
import {join} from "node:path"
import {fixture, write, TestSyncWizard} from "./fixture.ts"
import {ProjectStateStore} from "../src/project/ProjectStateStore.ts"
import {managedFiles, managedItems} from "../src/managed/ManagedDefinitions.ts"
import {managedItemIds} from "../src/managed/ManagedItem.ts"
import {ConfigScanner} from "../src/sync/ConfigScanner.ts"
import {ConfigApplier} from "../src/sync/ConfigApplier.ts"
import {ConfigWriter} from "../src/sync/ConfigWriter.ts"
import {SyncService} from "../src/sync/SyncService.ts"
import {ConfigResolver} from "../src/sync/ConfigResolver.ts"
import {FrameworkRegistryClient} from "../src/framework/FrameworkRegistryClient.ts"
import {cliCompatibility} from "../src/CliMetadata.ts"
import {registryRegion, registryCluster, npmrcFile, packageJsonFile, packageNameRegion, frameworkDependencyRegion} from "../src/node-js/NodeFiles.ts"
import {cmakeListsFile, jucePluginCluster, pluginVersionRegion, pluginFormatsRegion, productNameRegion, frameworkVersionRegion, fetchContentRepositoryRegion} from "../src/cmake/CmakeTextStuffs.ts"
import {TextFile, JsonFile} from "../src/managed/ManagedFile.ts"
import {TextCluster} from "../src/managed/TextCluster.ts"
import {TextRegion} from "../src/managed/TextRegion.ts"
import {JsonRegion} from "../src/managed/JsonRegion.ts"
import type {FileSnapshot} from "../src/util/FileUtils.ts"

const store = new ProjectStateStore()
const scanner = new ConfigScanner()
beforeEach(() => {
    mock.method(FrameworkRegistryClient.prototype, "fetchCandidateByVersion", async (version: string) => ({version, cliCompatibility, markedLatest: false, publishedAt: null}))
})
afterEach(() => mock.restoreAll())

class TestSyncService extends SyncService {
    override readonly syncWizard: TestSyncWizard
    override readonly configResolver: ConfigResolver

    constructor(syncWizard: TestSyncWizard) {
        super()
        this.syncWizard = syncWizard
        this.configResolver = new ConfigResolver(syncWizard, this.configApplier.writer)
    }
}
const run = (syncWizard: TestSyncWizard) => new TestSyncService(syncWizard)

async function noJournal(root: string) { await assert.rejects(readdir(join(root, ".arrange")), {code: "ENOENT"}) }

test("同源生成后全部 Idle；检查本身无副作用", async t => {
    const state = await fixture(t)
    const report = await scanner.scan(state, "Global")
    assert.equal(report.fatal.length + report.resolvable.length + report.applicable.length, 0)
    assert.equal(report.idle.filter(item => item.target.region).length, managedItems.reduce((count, item) => count + item.regions.length, 0))
    await noJournal(state.rootDir)
})

test("关闭的 ManagedItem 不检查缺失父级、裸内容或损坏 Wrapper", async t => {
    const state = await fixture(t, false)
    state.project["managed-items"] = []
    await write(cmakeListsFile.path(state), "# arrange:begin region:cmake.plugin-version\n")
    const report = await scanner.scan(state, "Global")
    assert.deepEqual(report, {scope: "Global", fatal: [], resolvable: [], idle: [], applicable: []})
})

test("Fatal、Resolvable、Idle、Applicable 完整收集；Fatal 阻止交互与 Apply", async t => {
    const state = await fixture(t)
    await write(packageJsonFile.path(state), "{")
    await write(cmakeListsFile.path(state), "自定义 CMake\n")
    const registry = registryCluster.wrapper.make(registryRegion.wrapper.make("@arrange:registry=old\n"))
    await write(npmrcFile.path(state), registry)
    const ui = new TestSyncWizard()
    const result = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "blocked")
    const report = result.report!
    assert.equal(report.fatal.length, 1)
    assert.equal(report.resolvable.length, 2)
    assert.equal(report.applicable.length, 1)
    assert.ok(report.idle.length)
    assert.equal(ui.choices, 0)
    assert.equal(report.idle.some(entry => entry.target.region?.kind === "json-region"), false)
    assert.equal(await readFile(npmrcFile.path(state), "utf8"), registry)
    await noJournal(state.rootDir)
})

test("文件缺失只报告文件，不调用子级 check；独立分支继续", async t => {
    const state = await fixture(t)
    await rm(cmakeListsFile.path(state))
    const report = await scanner.scan(state, "Global")
    assert.equal(report.resolvable.length, 1)
    assert.equal(report.resolvable[0].target.file, cmakeListsFile)
    assert.equal(report.resolvable[0].target.cluster, undefined)
    assert.ok(report.idle.some(entry => entry.target.region === registryRegion))
})

test("每轮 Resolve 只处理一项，文件创建后重扫，最终 Apply 后不复检", async t => {
    const state = await fixture(t, false)
    const ui = new TestSyncWizard()
    ui.onChoose = async () => "create"
    const result = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.equal(ui.choices, 3)
    assert.equal(ui.reports.length, 4)
    assert.deepEqual(ui.reports.map(report => report.resolvable.length), [3, 2, 1, 0])
    for (const file of managedFiles) assert.equal(await readFile(file.path(state), "utf8"), file.make(state))
    const journals = await readdir(join(state.rootDir, ".arrange", "transactions"))
    assert.equal(journals.length, 3)
    assert.equal(await readFile(join(state.rootDir, ".arrange", ".gitignore"), "utf8"), "*\n")
})

test("文本精确更新多个 Region，保留 Wrapper、自定义内容和关闭的 Region", async t => {
    const state = await fixture(t)
    state.project["managed-items"] = [managedItemIds.pluginVersion, managedItemIds.pluginFormats]
    state.project.project.version = "2.3.4"
    state.project.project.products = ["vst3"]
    const path = cmakeListsFile.path(state)
    let before = await readFile(path, "utf8")
    before = `# 前缀🙂\n${before.replace(jucePluginCluster.wrapper.begin, `${jucePluginCluster.wrapper.begin}\n# 自定义`)}# 后缀\n`
    await write(path, before)
    const report = await scanner.scan(state, "Native")
    assert.equal(report.applicable.length, 2)
    const expected = before.replace(pluginVersionRegion.wrapper.make('    VERSION "1.0.0"\n'), pluginVersionRegion.make(state)).replace(pluginFormatsRegion.wrapper.make("    FORMATS Standalone VST3\n"), pluginFormatsRegion.make(state))
    await new ConfigApplier().apply(state.rootDir, report)
    assert.equal(await readFile(path, "utf8"), expected)
    assert.equal((await scanner.scan(state, "Native")).applicable.length, 0)
})

test("扫描模式只展示 Applicable，退出成功且不建立 .arrange", async t => {
    const state = await fixture(t)
    state.project.project.version = "2.0.0"
    await store.save(state)
    const before = await readFile(cmakeListsFile.path(state), "utf8")
    const ui = new TestSyncWizard()
    const result = await run(ui).run({configOnly: true, scanOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.equal(result.report!.applicable.length, 1)
    assert.equal(ui.choices, 0)
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), before)
    await noJournal(state.rootDir)
})

test("范围过滤仅扫描选中分支，不改变 ManagedItem 开关", async t => {
    const state = await fixture(t)
    await write(packageJsonFile.path(state), "bad json")
    const input = structuredClone(state)
    const report = await scanner.scan(state, "Native")
    assert.equal(report.fatal.length, 0)
    assert.ok(report.idle.every(entry => entry.target.file.scope === "Native"))
    assert.deepEqual(state, input)
})

test("名称和 Framework 版本共同更新 UI/native，保留 CMake target、源路径及自定义内容", async t => {
    const state = await fixture(t)
    const cmakeBefore = `# 自定义前缀\n${await readFile(cmakeListsFile.path(state), "utf8")}# 自定义后缀\n`
    await write(cmakeListsFile.path(state), cmakeBefore)
    const packageBefore = {...JSON.parse(await readFile(packageJsonFile.path(state), "utf8")), custom: "保留"}
    await write(packageJsonFile.path(state), JSON.stringify(packageBefore))
    state.project.project.name = "RenamedPlugin"
    state.project.framework.version = "0.0.0-m.2.3"
    await store.save(state)

    const ui = new TestSyncWizard()
    const result = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.equal(ui.choices, 0)
    assert.equal(ui.reports.length, 1)
    assert.deepEqual(new Set(result.report!.applicable.map(update => update.target.region)), new Set([productNameRegion, packageNameRegion, frameworkVersionRegion, frameworkDependencyRegion]))
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), cmakeBefore.replace('PRODUCT_NAME "TestPlugin"', 'PRODUCT_NAME "RenamedPlugin"').replace('GIT_TAG "v0.0.0-m.2.2"', 'GIT_TAG "v0.0.0-m.2.3"'))
    assert.deepEqual(JSON.parse(await readFile(packageJsonFile.path(state), "utf8")), {...packageBefore, name: "renamedplugin", dependencies: {...packageBefore.dependencies, "@arrange/framework": "0.0.0-m.2.3"}})
})

test("只托管 FetchContent 仓库地址时，版本的文本与 JSON 均不更新", async t => {
    const state = await fixture(t)
    const cmakeBefore = await readFile(cmakeListsFile.path(state), "utf8")
    const packageBefore = await readFile(packageJsonFile.path(state), "utf8")
    state.project["managed-items"] = [managedItemIds.fetchContentRepository]
    state.project.framework.cmakeFetchContentUrl = "https://example.com/Arrange.git"
    state.project.framework.version = "0.0.0-m.2.3"
    await store.save(state)

    const result = await run(new TestSyncWizard()).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.deepEqual(result.report!.applicable.map(update => update.target.region), [fetchContentRepositoryRegion])
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), cmakeBefore.replace('GIT_REPOSITORY "https://github.com/EarzuChan/Arrange.git"', 'GIT_REPOSITORY "https://example.com/Arrange.git"'))
    assert.equal(await readFile(packageJsonFile.path(state), "utf8"), packageBefore)
})

test("只托管 Framework 版本时更新两端，保留未托管仓库地址", async t => {
    const state = await fixture(t)
    const cmakeBefore = await readFile(cmakeListsFile.path(state), "utf8")
    const packageBefore = JSON.parse(await readFile(packageJsonFile.path(state), "utf8"))
    state.project["managed-items"] = [managedItemIds.frameworkVersion]
    state.project.framework.cmakeFetchContentUrl = "https://example.com/Arrange.git"
    state.project.framework.version = "0.0.0-m.2.3"
    await store.save(state)

    const result = await run(new TestSyncWizard()).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.deepEqual(new Set(result.report!.applicable.map(update => update.target.region)), new Set([frameworkVersionRegion, frameworkDependencyRegion]))
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), cmakeBefore.replace('GIT_TAG "v0.0.0-m.2.2"', 'GIT_TAG "v0.0.0-m.2.3"'))
    assert.deepEqual(JSON.parse(await readFile(packageJsonFile.path(state), "utf8")), {...packageBefore, dependencies: {...packageBefore.dependencies, "@arrange/framework": "0.0.0-m.2.3"}})
})

for (const scope of ["UI", "Native"] as const) {
    test(`跨范围 ManagedItem 在 ${scope} 同步时只更新所选分支，不改变共同开关`, async t => {
        const state = await fixture(t)
        state.project["managed-items"] = [managedItemIds.projectName, managedItemIds.frameworkVersion]
        state.project.project.name = "RenamedPlugin"
        state.project.framework.version = "0.0.0-m.2.3"
        await store.save(state)
        const otherFile = scope === "UI" ? cmakeListsFile : packageJsonFile
        const otherBefore = await readFile(otherFile.path(state), "utf8")

        const result = await run(new TestSyncWizard()).run({configOnly: true, uiOnly: scope === "UI", nativeOnly: scope === "Native"}, state.rootDir)
        assert.equal(result.status, "completed")
        assert.equal(result.report!.applicable.length, 2)
        assert.ok(result.report!.applicable.every(update => update.target.file.scope === scope))
        assert.equal(await readFile(otherFile.path(state), "utf8"), otherBefore)
        const loaded = await store.inspect(state.rootDir)
        assert.deepEqual(loaded.state!.project["managed-items"], state.project["managed-items"])
        const remaining = await scanner.scan(loaded.state!, "Global")
        assert.equal(remaining.fatal.length + remaining.resolvable.length, 0)
        assert.equal(remaining.applicable.length, 2)
        assert.ok(remaining.applicable.every(update => update.target.file === otherFile))
    })
}

test("关闭共同开关：创建时生成裸文本和 JSON 初值，同步忽略两端即使有损坏 Wrapper", async t => {
    const state = await fixture(t, false)
    state.project["managed-items"] = [managedItemIds.pluginVersion]
    const generated = cmakeListsFile.make(state)
    assert.ok(generated.includes('PRODUCT_NAME "TestPlugin"\n'))
    assert.ok(generated.includes('GIT_TAG "v0.0.0-m.2.2"\n'))
    assert.equal(generated.includes(productNameRegion.wrapper.begin), false)
    assert.equal(generated.includes(frameworkVersionRegion.wrapper.begin), false)
    const json = JSON.parse(packageJsonFile.make(state))
    assert.equal(json.name, "testplugin")
    assert.equal(json.dependencies["@arrange/framework"], "0.0.0-m.2.2")

    await write(cmakeListsFile.path(state), generated.replace('PRODUCT_NAME "TestPlugin"', `${productNameRegion.wrapper.begin}\n    PRODUCT_NAME "手改"`).replace('GIT_TAG "v0.0.0-m.2.2"', `${frameworkVersionRegion.wrapper.begin}\n    GIT_TAG "手改"`))
    await write(packageJsonFile.path(state), "坏 JSON")
    state.project.project.name = "Changed"
    state.project.framework.version = "0.0.0-m.2.3"
    const report = await scanner.scan(state, "Global")
    assert.equal(report.fatal.length + report.resolvable.length + report.applicable.length, 0)
    assert.deepEqual(report.idle.filter(entry => entry.target.region).map(entry => entry.target.region), [pluginVersionRegion])
    await noJournal(state.rootDir)
})

test("共同名称的一端缺文件时另一端仍报告过期，取消恢复不能提前更新另一端", async t => {
    const state = await fixture(t)
    state.project["managed-items"] = [managedItemIds.projectName]
    state.project.project.name = "RenamedPlugin"
    await store.save(state)
    await rm(cmakeListsFile.path(state))
    const packageBefore = await readFile(packageJsonFile.path(state), "utf8")
    const ui = new TestSyncWizard()
    const result = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "aborted")
    assert.equal(result.report!.resolvable.length, 1)
    assert.equal(result.report!.resolvable[0].target.file, cmakeListsFile)
    assert.equal(result.report!.resolvable[0].target.region, undefined)
    assert.deepEqual(result.report!.applicable.map(update => update.target.region), [packageNameRegion])
    assert.equal(await readFile(packageJsonFile.path(state), "utf8"), packageBefore)
    await noJournal(state.rootDir)
})

test("已有内容补 Wrapper 后保留到重扫，再按配置 Apply", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, registryCluster.wrapper.make("@arrange:registry=old\n"))
    const ui = new TestSyncWizard()
    ui.onChoose = async () => "wrap"
    ui.onEdit = async () => {
        await write(path, registryCluster.wrapper.make(registryRegion.wrapper.make("@arrange:registry=old\n")))
        return true
    }
    const result = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(result.status, "completed")
    assert.equal(ui.reports.length, 2)
    assert.equal(ui.reports[1].applicable.length, 1)
    assert.equal(await readFile(path, "utf8"), npmrcFile.make(state))
})

test("Marker 建立 Region，保留父级自定义内容并删除一次性 Marker", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, registryCluster.wrapper.make("# 自定义\n"))
    const ui = new TestSyncWizard()
    ui.onChoose = async () => "marker"
    ui.onEdit = async () => { await write(path, registryCluster.wrapper.make(`# 自定义\n${registryRegion.wrapper.marker}\n`)); return true }
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "completed")
    assert.equal(await readFile(path, "utf8"), registryCluster.wrapper.make(`# 自定义\n${registryRegion.make(state)}`))
    assert.equal(ui.reports.length, 2)
})

test("交互时 YAML 改变，重载开关，不依据旧 Marker 写入", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, registryCluster.wrapper.make(""))
    const ui = new TestSyncWizard()
    ui.onChoose = async () => "marker"
    ui.onEdit = async () => {
        state.project["managed-items"] = []
        await store.save(state)
        await write(path, registryCluster.wrapper.make(`${registryRegion.wrapper.marker}\n`))
        return true
    }
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "completed")
    assert.equal((await readFile(path, "utf8")).includes(registryRegion.wrapper.marker), true)
    await noJournal(state.rootDir)
})

test("JSON 缺字段确认补入，类型损坏只允许手改；取消无写入", async t => {
    const state = await fixture(t)
    const path = packageJsonFile.path(state)
    await write(path, JSON.stringify({name: "testplugin", dependencies: 123, other: "keep"}))
    const ui = new TestSyncWizard()
    ui.onChoose = async (_issue, choices) => {assert.deepEqual(choices, ["edit", "abort"]); return "abort"}
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "aborted")
    await noJournal(state.rootDir)
    await write(path, JSON.stringify({name: "testplugin", other: "keep"}))
    const confirm = new TestSyncWizard()
    confirm.onChoose = async () => "create"
    assert.equal((await run(confirm).run({configOnly: true}, state.rootDir)).status, "completed")
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {name: "testplugin", other: "keep", dependencies: {"@arrange/framework": state.project.framework.version}})
})

test("扫描后文件或 YAML 被外部修改，Apply 拒绝且不覆写", async t => {
    const state = await fixture(t)
    state.project.project.version = "2.0.0"
    const report = await scanner.scan(state, "Global")
    const path = cmakeListsFile.path(state)
    const modified = `${await readFile(path, "utf8")}# 并发编辑\n`
    await write(path, modified)
    await assert.rejects(new ConfigApplier().apply(state.rootDir, report), /发生变化/)
    assert.equal(await readFile(path, "utf8"), modified)
    const latest = await scanner.scan(state, "Global")
    const loaded = await store.inspect(state.rootDir)
    await write(join(state.rootDir, "arrange.project.yaml"), "changed")
    await assert.rejects(new ConfigApplier().apply(state.rootDir, latest, loaded.snapshots), /发生变化/)
    await noJournal(state.rootDir)
})

test("多文件写入中断保留原文、目标及进度，能区分已写、未写、冲突", async t => {
    const state = await fixture(t)
    state.project.project.name = "Changed"
    state.project.project.version = "2.0.0"
    const report = await scanner.scan(state, "Global")
    class FailingWriter extends ConfigWriter {
        calls = 0
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            if (++this.calls === 2) throw new Error("模拟磁盘错误")
            return super.replaceFile(before, after, id)
        }
    }
    const writer = new FailingWriter()
    await assert.rejects(new ConfigApplier(writer).apply(state.rootDir, report), /模拟磁盘错误/)
    const dir = join(state.rootDir, ".arrange", "transactions")
    const journalPath = join(dir, (await readdir(dir))[0])
    const recovered = await writer.inspectJournal(journalPath)
    assert.equal(recovered.journal.status, "failed")
    assert.deepEqual(recovered.states, ["expected", "original"])
    await write(recovered.journal.files[1].path, "用户又改了")
    assert.deepEqual((await writer.inspectJournal(journalPath)).states, ["expected", "conflict"])
    const files = await readdir(state.rootDir, {recursive: true})
    assert.equal(files.some(path => path.endsWith(".tmp")), false)
})

test("坏 YAML 收集双方诊断；local 坏时仍扫描独立工程文件；目录目标 Fatal", async t => {
    const state = await fixture(t)
    await write(join(state.rootDir, "arrange.local.yaml"), "[")
    await rm(npmrcFile.path(state))
    await mkdir(npmrcFile.path(state))
    const ui = new TestSyncWizard()
    const first = await run(ui).run({configOnly: true}, state.rootDir)
    assert.equal(first.status, "blocked")
    assert.equal(first.report!.fatal.length, 2)
    assert.ok(first.report!.idle.some(entry => entry.target.file === cmakeListsFile))
    await write(join(state.rootDir, "arrange.project.yaml"), "[")
    const second = await run(new TestSyncWizard()).run({configOnly: true}, state.rootDir)
    assert.equal(second.report!.fatal.length, 2)
    assert.equal(second.report!.idle.length, 0)
})

test("同一 ManagedItem 跨文本和 JSON，一支缺失不阻止另一支扫描", async t => {
    const state = await fixture(t, false)
    state.project["managed-items"] = ["both"]
    const text = new TextRegion("text", "both", () => "expected\n")
    const cluster = new TextCluster("cluster", [text], s => text.make(s))
    const textFile = new TextFile("text", "Native", s => join(s.rootDir, "text.txt"), [cluster], s => cluster.make(s))
    const json = new JsonRegion("json", "both", ["value"], () => undefined)
    const jsonFile = new JsonFile("json", "UI", s => join(s.rootDir, "data.json"), [json], () => ({}))
    await write(jsonFile.path(state), '{"value":null,"other":7}')
    const custom = new ConfigScanner([textFile, jsonFile], [{id: "both", label: "both", regions: [text, json]}])
    const report = await custom.scan(state, "Global")
    assert.equal(report.resolvable.length, 1)
    assert.equal(report.applicable.length, 1)
    await assert.rejects(new ConfigApplier().apply(state.rootDir, report), /阻塞/)
    await write(textFile.path(state), textFile.make(state))
    await new ConfigApplier().apply(state.rootDir, await custom.scan(state, "Global"))
    assert.deepEqual(JSON.parse(await readFile(jsonFile.path(state), "utf8")), {other: 7})
})

test("兼容性失败为 Fatal；SETUP 未实现不能伪装成功", async t => {
    const state = await fixture(t)
    const ui = new TestSyncWizard()
    const registryFailure = t.mock.method(FrameworkRegistryClient.prototype, "fetchCandidateByVersion", async () => {throw new Error("不兼容")})
    const service = run(ui)
    assert.equal((await service.run({configOnly: true}, state.rootDir)).status, "blocked")
    assert.equal(ui.reports[0].fatal[0].cause, "framework-incompatible")
    registryFailure.mock.restore()
    assert.equal((await run(new TestSyncWizard()).run({}, state.rootDir)).status, "setup-unavailable")
    await assert.rejects(run(new TestSyncWizard()).run({configOnly: true, setupOnly: true}, state.rootDir), /互斥/)
})


test("Marker 新建 Cluster，子 Region 重扫后才出现", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, "# 外部文本\n")
    const ui = new TestSyncWizard()
    ui.onChoose = async () => "marker"
    ui.onEdit = async () => {await write(path, `# 外部文本\n${registryCluster.wrapper.marker}\n`); return true}
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "completed")
    assert.equal(ui.reports[0].idle.some(entry => entry.target.region === registryRegion), false)
    assert.equal(ui.reports[1].idle.some(entry => entry.target.region === registryRegion), true)
    assert.equal(await readFile(path, "utf8"), `# 外部文本\n${registryCluster.make(state)}`)
})

test("重复 Marker 和错误父级内的 Marker 均不写入", async t => {
    for (const mode of ["duplicate", "nested"] as const) {
        const state = await fixture(t)
        const path = npmrcFile.path(state)
        await write(path, registryCluster.wrapper.make(""))
        const ui = new TestSyncWizard()
        ui.onChoose = async () => ui.choices === 1 ? "marker" : "abort"
        const marker = `${registryRegion.wrapper.marker}\n`
        const content = registryCluster.wrapper.make(mode === "duplicate" ? marker + marker : `# arrange:begin region:custom\n${marker}# arrange:end region:custom\n`)
        ui.onEdit = async () => {await write(path, content); return true}
        assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "aborted")
        assert.equal(await readFile(path, "utf8"), content)
        assert.ok(ui.messages.length)
        await noJournal(state.rootDir)
    }
})

test("交互修复损坏 Wrapper 后全量重扫；未修好仍为同一 Issue", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, registryCluster.wrapper.make(`${registryRegion.wrapper.begin}\n`))
    const ui = new TestSyncWizard()
    ui.onChoose = async (issue, choices) => {assert.equal(issue.cause, "damaged"); assert.deepEqual(choices, ["edit", "abort"]); return "edit"}
    ui.onEdit = async () => {
        if (ui.choices === 2) await write(path, npmrcFile.make(state))
        return true
    }
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "completed")
    assert.equal(ui.reports.length, 3)
    assert.equal(ui.choices, 2)
    await noJournal(state.rootDir)
})

test("文件创建确认期间出现同名文件，拒绝覆盖", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await rm(path)
    const ui = new TestSyncWizard()
    ui.onChoose = async () => {await write(path, "用户新建\n"); return "create"}
    assert.equal((await run(ui).run({configOnly: true}, state.rootDir)).status, "failed")
    assert.equal(await readFile(path, "utf8"), "用户新建\n")
    await noJournal(state.rootDir)
})
