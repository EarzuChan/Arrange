import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UserDirectories } from "../src/user/UserDirectories.ts"
import { ProjectRegistry } from "../src/user/ProjectRegistry.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { CmakeService } from "../src/cmake/CmakeService.ts"
import { createPlatformService } from "../src/platform/CreatePlatformService.ts"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { Executor } from "../src/platform/Executor.ts"
import { GitSource } from "../src/source/GitSource.ts"
import { SourceCache } from "../src/source/SourceCache.ts"
import { StorageInventory } from "../src/storage/StorageInventory.ts"
import { StorageMaintenance } from "../src/storage/StorageMaintenance.ts"
import { buildPathKey } from "../src/storage/StoragePaths.ts"
import { describeStorageItem, describeCleanupBlockers } from "../src/ui/StorageReport.ts"
import { OperationHost } from "../src/operation/OperationHost.ts"
import { Operations } from "../src/operation/Operations.ts"
import { projectRegistrySchema, sourceCacheSchema, sourceReferencesSchema } from "../src/CliMetadata.ts"
import { stateFor, write, testTask, quietTerminal } from "./fixture.ts"
import { canonicalResource } from "../src/operation/Resource.ts"
import { createCliApplication } from "../src/CliApplication.ts"
import { TransactionStore } from "../src/transaction/TransactionStore.ts"

async function harness(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "arrange-storage-facts-"))
    const user = new UserDirectories(join(root, "user"))
    const signal = new AbortController().signal
    const executor = new Executor()
    const git = new GitSource(executor)
    const store = new ProjectStateStore(new FileTransaction(signal))
    const registry = new ProjectRegistry(user, signal)
    const cmake = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(signal), user)
    const host = new OperationHost(user)
    const operations = new Operations(host, signal, () => { })
    const cache = new SourceCache(user, git, signal, operations)
    const inventory = new StorageInventory(user, registry, git, signal, store, cmake)
    const maintenance = new StorageMaintenance(user, inventory, git, signal, registry)
    t.after(async () => {
        await host.close()
        await rm(root, { recursive: true, force: true })
    })
    const dependency = async () => {
        const repository = join(root, "repository")
        await write(join(repository, "CMakeLists.txt"), "project(StorageFixture NONE)\n")
        for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=测试", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "依赖源码夹具"]]) {
            const result = await executor.run({ command: "git", args, cwd: repository })
            assert.equal(result.exitCode, 0, result.stderr)
        }
        const result = await executor.run({ command: "git", args: ["rev-parse", "HEAD"], cwd: repository })
        assert.equal(result.exitCode, 0, result.stderr)
        const commit = result.stdout.trim()
        return cache.ensure({ repository, ref: commit, commit }, "依赖源码夹具", testTask())
    }
    return { root, user, signal, executor, store, registry, inventory, maintenance, operations, dependency, host }
}

test("唯一依赖源码目录为 deps-src，空库存不创建目录或探测旧路径", async t => {
    const input = await harness(t)
    assert.equal(input.user.dependencySources, join(input.user.root, "deps-src"))
    assert.deepEqual(await input.inventory.inspect(), [])
    await assert.rejects(readdir(input.user.root), { code: "ENOENT" })
    await write(join(input.user.root, "sources", "用户旧文件"), "不接管")
    assert.deepEqual(await input.inventory.inspect(), [])
    assert.equal(await readFile(join(input.user.root, "sources", "用户旧文件"), "utf8"), "不接管")
})

test("工程登记区分格式不兼容、字段损坏、配置损坏、工程丢失和身份失效", async t => {
    const input = await harness(t)
    const project = join(input.root, "project")
    await mkdir(project)
    await input.store.save(stateFor(project))
    await input.registry.register(project)
    const registration = (await input.registry.list())[0]
    const bytes = await readFile(registration.path, "utf8")
    assert.equal((await input.inventory.inspect())[0].facts[1].check.state, "ready")
    await writeFile(registration.path, JSON.stringify({ schema: projectRegistrySchema - 1, root: "不应读取旧业务字段" }))
    const incompatible = (await input.inventory.inspect())[0]
    assert.equal(incompatible.facts[0].check.state, "incompatible")
    assert.equal(incompatible.path, registration.path)
    assert.equal(incompatible.facts.length, 1)
    await assert.rejects(input.registry.register(project), /当前仅支持/)
    await writeFile(registration.path, JSON.stringify({ schema: projectRegistrySchema }))
    assert.equal((await input.inventory.inspect())[0].facts[0].check.state, "damaged")
    await writeFile(registration.path, "{无法解析")
    assert.equal((await input.inventory.inspect())[0].facts[0].check.state, "damaged")
    await writeFile(registration.path, bytes)
    await write(join(project, "arrange.project.yaml"), "project: [")
    assert.equal((await input.inventory.inspect())[0].facts[1].check.state, "damaged")
    await input.store.save(stateFor(project))
    await rename(project, join(input.root, "moved"))
    assert.equal((await input.inventory.inspect())[0].facts[1].check.state, "missing")
    await mkdir(project)
    assert.equal((await input.inventory.inspect())[0].facts[1].check.state, "replaced")
})

test("设备身份无法确认时不把工程当成丢失，不授权孤儿清理", async t => {
    const input = await harness(t)
    const project = join(input.root, "project")
    await mkdir(project)
    await input.store.save(stateFor(project))
    await input.registry.register(project, input.user.builds)
    const registration = (await input.registry.list())[0]
    const record = JSON.parse(await readFile(registration.path, "utf8"))
    record.volume.device++
    await writeFile(registration.path, JSON.stringify(record))
    const base = join(input.user.builds, buildPathKey(project))
    await write(join(base, "owner.json"), JSON.stringify({ rootDir: project }))
    const items = await input.inventory.inspect()
    assert.equal(items.find(item => item.kind === "project")!.facts[1].check.state, "unavailable")
    const build = items.find(item => item.path === base)!
    assert.equal(build.facts.find(fact => fact.label === "ownership")!.check.state, "ready")
    assert.equal(build.facts.find(fact => fact.label === "project")!.check.state, "unavailable")
    assert.equal(build.cleanup.allowed, false)
})

test("归属明确的孤儿构建可清理，即使引用丢失；依赖源码仍受引用不完整保护", async t => {
    const input = await harness(t)
    const dependency = await input.dependency()
    const project = join(input.root, "project")
    await mkdir(project)
    await input.store.save(stateFor(project))
    await input.registry.register(project, input.user.builds)
    const base = join(input.user.builds, buildPathKey(project))
    await write(join(base, "owner.json"), JSON.stringify({ rootDir: project }))
    await write(join(base, "xd", "保留至确认"), "真实构建内容")
    let items = await input.inventory.inspect()
    let build = items.find(item => item.path === base)!
    assert.equal(build.cleanup.allowed, false)
    assert.equal(build.references.complete, false)
    assert.equal(build.references.blockers[0].state, "missing")
    await rename(project, join(input.root, "moved"))
    items = await input.inventory.inspect()
    build = items.find(item => item.path === base)!
    assert.equal(build.cleanup.allowed, true)
    const source = items.find(item => item.id === `deps-src:${dependency.key}`)!
    assert.equal(source.cleanup.allowed, false)
    assert.equal(source.references.complete, false)
    assert.ok(source.references.blockers.some(check => check.path.endsWith("source-references.json")))
    await input.operations.run([{ kind: "directory", path: input.user.dependencySources, mode: "write" }, { kind: "directory", path: base, mode: "write" }], "清理孤儿夹具", () => input.maintenance.clean([build]))
    await assert.rejects(readFile(join(base, "owner.json")), { code: "ENOENT" })
    assert.equal((await input.registry.list()).length, 0)
    assert.equal((await input.inventory.inspect()).find(item => item.id === source.id)!.cleanup.allowed, true)
})

test("依赖源码区分旧格式、记录丢失、内容丢失及真实 Git 修改，repair 不迁移旧格式", async t => {
    const input = await harness(t)
    const dependency = await input.dependency()
    const path = join(input.user.dependencySources, "entries", dependency.key)
    const marker = join(path, "complete.json")
    const bytes = await readFile(marker, "utf8")
    const find = async () => (await input.inventory.inspect()).find(item => item.id === `deps-src:${dependency.key}`)!
    assert.equal((await find()).cleanup.allowed, true)
    await writeFile(marker, JSON.stringify({ schema: sourceCacheSchema - 1 }))
    assert.equal((await find()).facts[0].check.state, "incompatible")
    assert.equal((await find()).repairable, false)
    await assert.rejects(input.maintenance.repair(dependency.key, testTask()), /当前仅支持/)
    await writeFile(marker, bytes)
    await write(join(dependency.directory, "CMakeLists.txt"), "实际修改")
    let item = await find()
    assert.equal(item.facts[1].check.state, "damaged")
    assert.equal(item.repairable, true)
    await rm(dependency.directory, { recursive: true })
    assert.equal((await find()).facts[1].check.state, "missing")
    await rm(marker)
    assert.equal((await find()).facts[0].check.state, "missing")
    await rm(path, { recursive: true })
    item = await find()
    assert.equal(item.facts[0].check.state, "missing")
    assert.equal(item.cleanup.allowed, false)
})

test("引用版本不兼容和登记问题展示具体阻断路径，检查结果不由中文文案驱动", async t => {
    const input = await harness(t)
    const dependency = await input.dependency()
    const project = join(input.root, "project")
    await mkdir(project)
    await input.store.save(stateFor(project))
    await input.registry.register(project, input.user.builds)
    const base = join(input.user.builds, buildPathKey(project))
    await write(join(base, "owner.json"), JSON.stringify({ rootDir: project }))
    const refsPath = join(base, "xd", "source-references.json")
    await write(refsPath, JSON.stringify({ schema: sourceReferencesSchema + 1 }))
    let items = await input.inventory.inspect()
    const source = items.find(item => item.id === `deps-src:${dependency.key}`)!
    assert.equal(source.references.blockers[0].state, "incompatible")
    assert.equal(source.references.blockers[0].path, refsPath)
    assert.ok(describeStorageItem(source).includes(refsPath))
    assert.ok(describeCleanupBlockers(items).some(line => line.includes("引用")))
    await write(refsPath, JSON.stringify({ schema: sourceReferencesSchema, directories: [dependency.directory] }))
    items = await input.inventory.inspect()
    const used = items.find(item => item.id === source.id)!
    assert.equal(used.references.complete, true)
    assert.deepEqual(used.references.paths, [join(base, "xd")])
    assert.equal(used.cleanup.allowed, false)
    await input.registry.register(project)
    const registration = (await input.registry.list())[0]
    await writeFile(registration.path, JSON.stringify({ schema: projectRegistrySchema - 1 }))
    const blocked = (await input.inventory.inspect()).find(item => item.id === source.id)!
    assert.ok(blocked.references.blockers.some(check => check.path === registration.path))
})

test("目录链接与错误 owner 不被授权清理，扫描不跟随用户目录外的内容", async t => {
    const input = await harness(t)
    const outside = join(input.root, "outside")
    await write(join(outside, "用户文件"), "保留")
    await mkdir(input.user.builds, { recursive: true })
    const alias = join(input.user.builds, "12345678")
    await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir")
    const first = (await input.inventory.inspect()).find(item => item.path === alias)!
    assert.equal(first.cleanup.allowed, false)
    await rm(alias)
    await write(join(alias, "owner.json"), JSON.stringify({ rootDir: join(input.root, "丢失工程") }))
    const wrong = (await input.inventory.inspect()).find(item => item.path === alias)!
    assert.equal(wrong.facts[0].check.state, "damaged")
    assert.equal(wrong.cleanup.allowed, false)
    assert.equal(await readFile(join(outside, "用户文件"), "utf8"), "保留")
})

test("真实工作进程占用使清理预览明确排除候选，释放后重新扫描可清理", async t => {
    const input = await harness(t)
    const project = join(input.root, "已丢失工程")
    const base = join(input.user.builds, buildPathKey(project))
    await write(join(base, "owner.json"), JSON.stringify({ rootDir: project }))
    const release = await input.host.acquire([await canonicalResource({ kind: "directory", path: base, mode: "write" })], "真实写占用夹具", input.signal, () => { })
    const run = async () => {
        const terminal = quietTerminal()
        try {
            await createCliApplication({ signal: input.signal, interactions: "terminal", terminal, userDirectories: input.user }).exitOverride().parseAsync(["node", "arrange", "storage", "clean", "--scan"])
            return terminal.output.text
        } finally { terminal.close() }
    }
    try {
        const output = await run()
        assert.match(output, /没有可安全清理的候选/)
        assert.match(output, /占用/)
        assert.match(output, /真实写占用夹具/)
        assert.equal(await readFile(join(base, "owner.json"), "utf8"), JSON.stringify({ rootDir: project }))
    } finally { await release() }
    assert.match(await run(), /候选及排除原因已展示/)
})

test("未完成用户事务阻止所有清理和修复，检查展示实际恢复入口", async t => {
    const input = await harness(t)
    const dependency = await input.dependency()
    const transactions = new TransactionStore(input.user.root, input.user.transactions)
    await transactions.create("delete", { phase: "未完成夹具" })
    const item = (await input.inventory.inspect()).find(item => item.id === `deps-src:${dependency.key}`)!
    assert.equal(item.cleanup.allowed, false)
    assert.equal(item.repairable, false)
    assert.ok(item.facts.some(fact => fact.label === "transaction"))
    assert.match(describeStorageItem(item), /arrange storage recover/)
})
