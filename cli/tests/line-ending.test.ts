import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { configRegistry } from "../src/config/ConfigRegistry.ts"
import { defaultProjectDirectories, cliCompatibility } from "../src/CliMetadata.ts"
import { cmakeListsFile, pluginVersionRegion } from "../src/cmake/CmakeStuffs.ts"
import { npmrcFile, packageJsonFile, registryCluster, registryRegion } from "../src/node-js/NodeJsStuffs.ts"
import { FrameworkRegistryClient } from "../src/framework/FrameworkRegistryClient.ts"
import { FrameworkService } from "../src/framework/FrameworkService.ts"
import type { CreateProjectRequest } from "../src/project/CreateProject.ts"
import { ProjectInitializer } from "../src/project/ProjectInitializer.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { ConfigApplier } from "../src/sync/ConfigApplier.ts"
import { ConfigResolver } from "../src/sync/ConfigResolver.ts"
import { ConfigScanner } from "../src/sync/ConfigScanner.ts"
import { ConfigWriter } from "../src/sync/ConfigWriter.ts"
import { SyncService } from "../src/sync/SyncService.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { detectJsonLayout, detectLineEnding, normalizeLineEndings, serializeJson, toLineEnding } from "../src/util/LineEnding.ts"
import { fixture, TestSyncWizard, write, quietTerminal } from "./fixture.ts"

const scanner = new ConfigScanner(configRegistry)
const pluginVersion = configRegistry.items.find(item => item.id === pluginVersionRegion.managedItemId)!

class TestRegistryClient extends FrameworkRegistryClient {
    override async fetchCandidateByVersion(version: string) {
        return { version, cliCompatibility, markedLatest: false, publishedAt: null }
    }
}

function run(wizard: TestSyncWizard): SyncService {
    const signal = new AbortController().signal
    const writer = new ConfigWriter(signal)
    return new SyncService(new ProjectStateStore(new FileTransaction(signal)), new FrameworkService(new TestRegistryClient()), new ConfigScanner(configRegistry), new ConfigResolver(writer, wizard, signal), new ConfigApplier(writer), { run: async () => ({ status: "blocked" }) }, wizard, signal, quietTerminal().tasks)
}

const loneLf = (text: string): number => (text.match(/(?<!\r)\n/g) ?? []).length
const loneCr = (text: string): number => (text.match(/\r(?!\n)/g) ?? []).length

test("换行检测：多数决，无换行或持平取 LF", () => {
    assert.equal(detectLineEnding(""), "\n")
    assert.equal(detectLineEnding("a"), "\n")
    assert.equal(detectLineEnding("a\nb\n"), "\n")
    assert.equal(detectLineEnding("a\r\nb\r\n"), "\r\n")
    assert.equal(detectLineEnding("a\r\nb\r\nc\n"), "\r\n")
    assert.equal(detectLineEnding("a\r\nb\n"), "\n")
})

test("换行转换：幂等，不产生双 CR，孤立 CR 保持原样", () => {
    for (const lineEnding of ["\n", "\r\n"] as const) {
        const once = toLineEnding("a\nb\r\nc\n", lineEnding)
        assert.equal(toLineEnding(once, lineEnding), once)
        assert.equal(loneCr(once), 0)
        assert.equal(once, lineEnding === "\n" ? "a\nb\nc\n" : "a\r\nb\r\nc\r\n")
    }
    assert.equal(normalizeLineEndings("a\r\nb\r\n"), "a\nb\n")
    assert.equal(toLineEnding("x\ry", "\r\n"), "x\ry")
})

test("JSON 布局检测：保留制表符或空格缩进与换行风格", () => {
    assert.deepEqual(detectJsonLayout('{\r\n\t"a": 1\r\n}\r\n'), { indent: "\t", lineEnding: "\r\n" })
    assert.deepEqual(detectJsonLayout('{\n    "a": 1\n}\n'), { indent: "    ", lineEnding: "\n" })
    assert.deepEqual(detectJsonLayout("{}"), { indent: "  ", lineEnding: "\n" })
    assert.equal(serializeJson({ a: { b: 1 } }, { indent: "\t", lineEnding: "\r\n" }), '{\r\n\t"a": {\r\n\t\t"b": 1\r\n\t}\r\n}\r\n')
})

test("CRLF 文件里同内容的托管区块是 Idle，不制造 Applicable", async t => {
    const state = await fixture(t)
    for (const file of configRegistry.files) if (file.kind === "text-file") await write(file.path(state), toLineEnding(file.make(state), "\r\n"))
    const report = await scanner.scan(state, "Global")
    assert.equal(report.fatal.length + report.resolvable.length + report.applicable.length, 0)
})

test("CRLF 文件更新区块后仍是纯 CRLF，不混入孤立 LF", async t => {
    const state = await fixture(t)
    state.project["managed-items"] = [pluginVersion.id]
    const path = cmakeListsFile.path(state)
    await write(path, toLineEnding(cmakeListsFile.make(state), "\r\n"))
    state.project.project.version = "2.3.4"
    const report = await scanner.scan(state, "Native")
    assert.equal(report.applicable.length, 1)
    await new ConfigApplier(new ConfigWriter()).apply(state.rootDir, report)
    const after = await readFile(path, "utf8")
    assert.match(after, /VERSION "2\.3\.4"/)
    assert.equal(loneLf(after), 0)
    assert.equal(loneCr(after), 0)
    assert.equal((await scanner.scan(state, "Native")).applicable.length, 0)
})

test("LF 文件更新区块后仍是纯 LF", async t => {
    const state = await fixture(t)
    state.project["managed-items"] = [pluginVersion.id]
    const path = cmakeListsFile.path(state)
    state.project.project.version = "2.3.4"
    const report = await scanner.scan(state, "Native")
    await new ConfigApplier(new ConfigWriter()).apply(state.rootDir, report)
    assert.equal((await readFile(path, "utf8")).includes("\r"), false)
})

test("CRLF 文件里按 Marker 新建区块使用 CRLF", async t => {
    const state = await fixture(t)
    const path = npmrcFile.path(state)
    await write(path, toLineEnding(registryCluster.wrapper.make("# 自定义\n"), "\r\n"))
    const wizard = new TestSyncWizard()
    wizard.onChoose = async () => "marker"
    wizard.onEdit = async () => {
        await write(path, toLineEnding(registryCluster.wrapper.make(`# 自定义\n${registryRegion.wrapper.marker}\n`), "\r\n"))
        return true
    }
    assert.equal((await run(wizard).run({ configOnly: true }, state.rootDir)).status, "completed")
    const after = await readFile(path, "utf8")
    assert.equal(loneLf(after), 0)
    assert.equal(after, toLineEnding(registryCluster.wrapper.make(`# 自定义\n${registryRegion.make(state)}`), "\r\n"))
})

test("缺失的 JSON 字段补入时保留制表符缩进与 CRLF", async t => {
    const state = await fixture(t)
    const path = packageJsonFile.path(state)
    await write(path, '{\r\n\t"name": "testplugin",\r\n\t"other": "keep"\r\n}\r\n')
    const wizard = new TestSyncWizard()
    wizard.onChoose = async () => "create"
    assert.equal((await run(wizard).run({ configOnly: true }, state.rootDir)).status, "completed")
    const after = await readFile(path, "utf8")
    assert.equal(loneLf(after), 0)
    assert.match(after, /\r\n\t"dependencies": \{\r\n\t\t"@arrange\/framework"/)
    assert.deepEqual(Object.keys(JSON.parse(after)), ["name", "other", "dependencies"])
})

async function temporaryRoot(t: TestContext): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "arrange-gitattributes-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    return root
}

function createRequest(rootDir: string): CreateProjectRequest {
    return { rootDir, projectName: "StarterPlugin", projectVersion: "1.2.3", frameworkVersion: "0.0.0-m.2.2", vendorName: "Test Company", vendorCode: "Test", pluginCode: "StrP", pluginType: "effect", packageManager: "npm", products: ["standalone", "vst3"], uiDirectory: defaultProjectDirectories.ui, nativeDirectory: defaultProjectDirectories.native, artifactsDirectory: defaultProjectDirectories.artifacts, managedItems: Object.fromEntries(configRegistry.items.map(item => [item.id, true])) }
}

test("create 为全新工程生成 LF 的 .gitattributes", async t => {
    const root = await temporaryRoot(t)
    await new ProjectInitializer(new FileTransaction()).create(createRequest(root))
    assert.equal(await readFile(join(root, ".gitattributes"), "utf8"), "* text=auto eol=lf\n")
})

test("create 不改写已有的 .gitattributes", async t => {
    const root = await temporaryRoot(t)
    await write(join(root, ".gitattributes"), "*.txt text eol=crlf\r\n")
    await new ProjectInitializer(new FileTransaction()).create(createRequest(root))
    assert.equal(await readFile(join(root, ".gitattributes"), "utf8"), "*.txt text eol=crlf\r\n")
})

test("起步工程新建文件一律 LF", async t => {
    const root = await temporaryRoot(t)
    const state = await new ProjectInitializer(new FileTransaction()).create(createRequest(root))
    for (const file of configRegistry.files) assert.equal((await readFile(file.path(state), "utf8")).includes("\r"), false, file.path(state))
})
