import assert from "node:assert/strict"
import { resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { cliCompatibility, frameworkPackageName } from "../src/CliMetadata.ts"
import { FrameworkRegistryClient } from "../src/framework/FrameworkRegistryClient.ts"
import { FrameworkService } from "../src/framework/FrameworkService.ts"
import { ProjectService } from "../src/project/ProjectService.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { ConfigurationReadiness } from "../src/sync/ConfigurationReadiness.ts"
import { fixture, write, TestSyncWizard } from "./fixture.ts"
import { ConfigScanner } from "../src/sync/ConfigScanner.ts"
import { configRegistry } from "../src/config/ConfigRegistry.ts"

class RecordingRegistry extends FrameworkRegistryClient {
    readonly calls: { version: string, registryUrl?: string }[] = []
    offline = false
    override async fetchCandidateByVersion(version: string, registryUrl?: string) {
        this.calls.push({ version, registryUrl })
        if (this.offline) throw new Error("registry 无法连接")
        return { version, cliCompatibility, markedLatest: false, publishedAt: null }
    }
}

async function setup(t: TestContext) {
    const state = await fixture(t, false)
    state.project.ui.directory = "custom-ui"
    state.project.framework.nodeRegistryUrl = "https://registry.example.invalid"
    const store = new ProjectStateStore(new FileTransaction())
    await store.save(state)
    const registry = new RecordingRegistry()
    const framework = new FrameworkService(registry)
    const project = new ProjectService(store, framework, new ConfigurationReadiness(new ConfigScanner(configRegistry), new TestSyncWizard()))
    const installedPath = resolve(state.rootDir, state.project.ui.directory, "node_modules", frameworkPackageName, "package.json")
    return { state, registry, framework, project, installedPath }
}

test("operational load 优先已安装确切版本，registry 离线仍可加载；显式 remote 继续查询远程", async t => {
    const input = await setup(t)
    await write(input.installedPath, JSON.stringify({ version: input.state.project.framework.version, arrange: { cliCompatibility } }))
    input.registry.offline = true
    assert.deepEqual(await input.project.load(input.state.rootDir), input.state)
    assert.equal(input.registry.calls.length, 0)
    await assert.rejects(input.framework.assertCompatible(input.state, "remote"), /registry 无法连接/)
    assert.equal(input.registry.calls.length, 1)
})

test("已安装匹配版本的坏 JSON、缺失或不兼容契约明确失败，不用 registry 掩盖", async t => {
    const cases = [
        { name: "JSON 损坏", make: (_version: string) => "{", error: /无法解析/ },
        { name: "缺 version", make: (_version: string) => "{}", error: /缺少有效 version/ },
        { name: "缺兼容契约", make: (version: string) => JSON.stringify({ version }), error: /未声明有效的 arrange\.cliCompatibility/ },
        { name: "契约类型损坏", make: (version: string) => JSON.stringify({ version, arrange: { cliCompatibility: String(cliCompatibility) } }), error: /未声明有效的 arrange\.cliCompatibility/ },
        { name: "契约不匹配", make: (version: string) => JSON.stringify({ version, arrange: { cliCompatibility: cliCompatibility + 1 } }), error: /CLI 兼容契约不一致/ },
    ]
    for (const entry of cases) await t.test(entry.name, async t => {
        const input = await setup(t)
        await write(input.installedPath, entry.make(input.state.project.framework.version))
        await assert.rejects(input.project.load(input.state.rootDir), entry.error)
        assert.equal(input.registry.calls.length, 0)
    })
})

test("已安装包缺失或仍是旧版本时验证共享版本，允许 native 单独更新而 UI 尚未升级", async t => {
    const input = await setup(t)
    assert.deepEqual(await input.project.load(input.state.rootDir), input.state)
    await write(input.installedPath, JSON.stringify({ version: "0.0.0-m.2.1", arrange: { cliCompatibility: cliCompatibility + 1 } }))
    assert.deepEqual(await input.project.load(input.state.rootDir), input.state)
    assert.deepEqual(input.registry.calls, [{ version: input.state.project.framework.version, registryUrl: input.state.project.framework.nodeRegistryUrl }, { version: input.state.project.framework.version, registryUrl: input.state.project.framework.nodeRegistryUrl }])
})
