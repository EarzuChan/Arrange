import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { OperationHost } from "../src/operation/OperationHost.ts"
import { Operations } from "../src/operation/Operations.ts"
import { canonicalResource } from "../src/operation/Resource.ts"
import { UserDirectories } from "../src/user/UserDirectories.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { CmakeService } from "../src/cmake/CmakeService.ts"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { createPlatformService } from "../src/platform/CreatePlatformService.ts"
import { ProjectRegistry } from "../src/user/ProjectRegistry.ts"
import { TransactionStore } from "../src/transaction/TransactionStore.ts"
import { DeleteTransaction } from "../src/transaction/DeleteTransaction.ts"
import { ReplacementTransaction } from "../src/transaction/ReplacementTransaction.ts"
import { RecoveryService } from "../src/transaction/RecoveryService.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { readSnapshot } from "../src/util/FileUtils.ts"
import { NativeBuildTree } from "../src/cmake/NativeBuildTree.ts"
import { write } from "./fixture.ts"
import { configureNative, cmakeRun } from "./native-fixture.ts"
import { BuildReferences } from "../src/source/BuildReferences.ts"
import { StorageInventory } from "../src/storage/StorageInventory.ts"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"
import { ProjectCleaner } from "../src/storage/ProjectCleaner.ts"
import { nativeProducts } from "./native-fixture.ts"
import { Packer } from "../src/packing/Packer.ts"
import { ArtifactLocator } from "../src/packing/ArtifactLocator.ts"
import { Executor } from "../src/platform/Executor.ts"
import { StorageMaintenance } from "../src/storage/StorageMaintenance.ts"
import { SourceCache } from "../src/source/SourceCache.ts"
import { GitSource } from "../src/source/GitSource.ts"
import { testTask } from "./fixture.ts"
import { stateFor } from "./fixture.ts"
import { ProjectInitializer, type CopyPlan } from "../src/project/ProjectInitializer.ts"

async function harness(t: { after: (callback: () => Promise<void>) => void }) {
    const root = await mkdtemp(join(tmpdir(), "arrange-maintenance-"))
    const user = new UserDirectories(join(root, "user"))
    await user.ensure(user.root)
    const signal = new AbortController().signal
    const host = new OperationHost(user)
    const operations = new Operations(host, signal, () => { })
    const transactions = new TransactionStore(root)
    const lifetime = { kind: "directory" as const, path: user.dependencySources, mode: "write" as const }
    t.after(async () => {
        await host.close()
        await rm(root, { recursive: true, force: true })
    })
    return { root, user, signal, operations, transactions, host, lifetime }
}

test("工程登记以真实路径去重，失败操作仍可追踪；失联与被替换分别识别", async t => {
    const input = await harness(t)
    const project = join(input.root, "project")
    await write(join(project, "arrange.project.yaml"), "project: {}")
    const alias = join(input.root, "alias")
    await symlink(project, alias, process.platform === "win32" ? "junction" : "dir")
    const registry = new ProjectRegistry(input.user, input.signal)
    await registry.register(project, join(input.root, "builds"))
    await registry.register(alias, join(input.root, "builds"))
    const records = await registry.list()
    assert.equal(records.length, 1)
    assert.equal(records[0].record!.buildRoots.length, 1)
    assert.equal(await registry.availability(project), "present")
    await rename(project, join(input.root, "moved"))
    assert.equal(await registry.availability(project), "missing")
    await mkdir(project)
    assert.equal(await registry.availability(project), "replaced")
})

test("真实 CMake 切换源码位置会重建嵌套缓存，相同身份保留增量；未知目录拒绝删除", async t => {
    const input = await harness(t)
    const source = join(input.root, "source")
    const first = join(input.root, "first")
    const second = join(input.root, "second")
    const build = join(input.root, "build")
    await write(join(source, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.24)\nproject(Outer NONE)\nexecute_process(COMMAND ${CMAKE_COMMAND} -S ${DEPENDENCY} -B ${CMAKE_BINARY_DIR}/tools RESULT_VARIABLE result)\nif(NOT result EQUAL 0)\nmessage(FATAL_ERROR \"子构建失败\")\nendif()\n")
    for (const path of [first, second]) await write(join(path, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.24)\nproject(Dependency NONE)\n")
    const tree = new NativeBuildTree(input.signal, input.user)
    let complete = await tree.prepare(source, build, [first])
    let result = await configureNative(source, build, [`-DDEPENDENCY=${first.replaceAll("\\", "/")}`])
    assert.equal(result.exitCode, 0, result.stdout + result.stderr)
    await complete()
    await write(join(build, "sentinel"), "保留")
    complete = await tree.prepare(source, build, [first])
    assert.equal(await readFile(join(build, "sentinel"), "utf8"), "保留")
    await complete()
    complete = await tree.prepare(source, build, [second])
    await assert.rejects(readFile(join(build, "sentinel")), { code: "ENOENT" })
    result = await configureNative(source, build, [`-DDEPENDENCY=${second.replaceAll("\\", "/")}`])
    assert.equal(result.exitCode, 0, result.stdout + result.stderr)
    await complete()
    const unknown = join(input.root, "unknown")
    await write(join(unknown, "user"), "保留")
    await assert.rejects(tree.prepare(source, unknown, [], true), /缺少归属记录/)
    await assert.rejects(tree.prepare(source, source, [], true), /覆盖源码根/)
})

test("替换事务在移动后异常退出的事实可继续或回退，用户修改导致冲突", async t => {
    const input = await harness(t)
    const destination = join(input.root, "product")
    const staged = join(input.root, "staged")
    const backup = join(input.root, "backup")
    await write(destination, "旧")
    await write(staged, "新")
    const transaction = new ReplacementTransaction(input.transactions)
    let record = await transaction.prepare([{ root: input.root, destination, staged, backup }])
    await rename(destination, backup)
    const recovery = new RecoveryService(input.transactions, input.operations, input.signal, input.lifetime)
    await recovery.apply(record.id, false)
    assert.equal(await readFile(destination, "utf8"), "新")
    await assert.rejects(readFile(backup), { code: "ENOENT" })
    await write(staged, "更新")
    record = await transaction.prepare([{ root: input.root, destination, staged, backup }])
    await rename(destination, backup)
    await rename(staged, destination)
    await recovery.apply(record.id, true)
    assert.equal(await readFile(destination, "utf8"), "新")
    await write(staged, "更新")
    record = await transaction.prepare([{ root: input.root, destination, staged, backup }])
    await write(destination, "用户修改")
    await assert.rejects(recovery.apply(record.id, false), /冲突/)
    assert.equal(await readFile(destination, "utf8"), "用户修改")
})

test("删除事务识别移动后未记进度的中断，只清理已确认内容并可继续", async t => {
    const input = await harness(t)
    const path = join(input.root, "generated")
    await write(join(path, "file"), "内容")
    const transaction = new DeleteTransaction(input.transactions)
    const record = await transaction.prepare([{ root: input.root, path }])
    const payload = record.payload as { entries: { quarantine: string }[] }
    await rename(path, payload.entries[0].quarantine)
    await transaction.apply(await input.transactions.read(record.id))
    await assert.rejects(readFile(join(path, "file")), { code: "ENOENT" })
    assert.deepEqual(await input.transactions.list(), [])
})

test("文件写入取消后独立恢复保留原文契约，链接与越界事务不能执行", async t => {
    const input = await harness(t)
    const first = join(input.root, "first")
    const second = join(input.root, "second")
    await write(first, "原文")
    const controller = new AbortController()
    class InterruptedWriter extends FileTransaction {
        protected override async replaceFile(before: Parameters<FileTransaction["write"]>[1][number]["before"], after: string, id: string) {
            await super.replaceFile(before, after, id)
            controller.abort()
        }
    }
    await assert.rejects(new InterruptedWriter(controller.signal).write(input.root, [{ before: await readSnapshot(first), after: "目标" }, { before: await readSnapshot(second), after: "新建" }]), { name: "AbortError" })
    const records = await input.transactions.list()
    const recovery = new RecoveryService(input.transactions, input.operations, input.signal, input.lifetime)
    await recovery.apply(records[0].id, false)
    assert.equal(await readFile(first, "utf8"), "目标")
    assert.equal(await readFile(second, "utf8"), "新建")
    const forged = await input.transactions.create("write", { files: [{ path: join(dirname(input.root), "outside"), original: null, expected: "非法", written: false }] })
    await assert.rejects(recovery.apply(forged.id, false), /归属内/)
})

test("构建引用先取并集，配置失败不漏旧引用；缺少引用阻止源码清理", async t => {
    const input = await harness(t)
    const build = join(input.root, "build")
    await mkdir(build)
    const references = new BuildReferences(build)
    await (await references.begin({ FETCHCONTENT_SOURCE_DIR_JUCE: "first" }, input.root))()
    const complete = await references.begin({ FETCHCONTENT_SOURCE_DIR_JUCE: "second" }, input.root)
    let record = JSON.parse(await readFile(join(build, "source-references.json"), "utf8"))
    assert.equal(record.directories.length, 2)
    await complete()
    record = JSON.parse(await readFile(join(build, "source-references.json"), "utf8"))
    assert.deepEqual(record.directories, [join(input.root, "second")])
})

test("实际强杀事务持有者后，重新取得资源并恢复移动边界", async t => {
    for (const kind of ["replace", "delete"]) await t.test(`事务类型：${kind}`, async t => {
        const input = await harness(t)
        await write(join(input.root, "destination"), "旧内容")
        await write(join(input.root, "staged"), "新内容")
        const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(import.meta.dirname, "fixtures/transaction-crash.ts"), input.root, kind], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL") })
        let output = ""
        let errors = ""
        child.stdout!.on("data", bytes => { output += bytes.toString() })
        child.stderr!.on("data", bytes => { errors += bytes.toString() })
        for (let count = 0; !output.includes("READY") && count < 150; count++) await delay(30)
        const match = output.match(/READY ([a-f0-9-]+)/)
        assert.ok(match, errors)
        const exited = once(child, "exit")
        child.kill("SIGKILL")
        await exited
        const recovery = new RecoveryService(input.transactions, input.operations, input.signal, input.lifetime)
        await recovery.apply(match[1], false)
        if (kind === "replace") assert.equal(await readFile(join(input.root, "destination"), "utf8"), "新内容")
        else await assert.rejects(readFile(join(input.root, "destination")), { code: "ENOENT" })
        assert.deepEqual(await input.transactions.list(), [])
    })
})

test("当前工程清理保留依赖与用户交付内容，真实构建树及凭据按范围移除", async t => {
    const { state, cmake } = await nativeProducts(t)
    await write(join(state.rootDir, "ui/dist/app.js"), "UI")
    await write(join(state.rootDir, "ui/node_modules/keep"), "依赖")
    const packed = await new Packer(new ArtifactLocator(cmake), new Executor()).pack(state, { flavor: "release", products: ["standalone", "vst3"] })
    await write(join(dirname(packed.products[0].path), "user.txt"), "用户文件")
    const cleaner = new ProjectCleaner(cmake, new AbortController().signal)
    const artifacts = await cleaner.plan(state, { ui: false, native: false, artifacts: true })
    await cleaner.execute(state, artifacts)
    assert.equal(await readFile(join(dirname(packed.products[0].path), "user.txt"), "utf8"), "用户文件")
    await assert.rejects(readFile(packed.products[0].binaryPath), { code: "ENOENT" })
    assert.equal(await readFile(join(state.rootDir, "ui/dist/app.js"), "utf8"), "UI")
    const generated = await cleaner.plan(state, { ui: true, native: true, artifacts: false })
    await cleaner.execute(state, generated)
    await assert.rejects(readFile(join(cmake.buildDirectory(state, "release"), "CMakeCache.txt")), { code: "ENOENT" })
    assert.equal(await readFile(join(state.rootDir, "ui/node_modules/keep"), "utf8"), "依赖")
})

test("真实 Git 缓存损坏后按确切 commit 修复，无引用条目清理并移除索引", async t => {
    const input = await harness(t)
    const repository = join(input.root, "repository")
    await write(join(repository, "CMakeLists.txt"), "project(Fixture NONE)\n")
    const executor = new Executor()
    const gitRun = async (args: readonly string[]) => {
        const result = await executor.run({ command: "git", args, cwd: repository })
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout.trim()
    }
    await gitRun(["init", "--quiet"])
    await gitRun(["-c", "user.name=测试", "-c", "user.email=test@example.invalid", "add", "."])
    await gitRun(["-c", "user.name=测试", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "夹具"])
    const commit = await gitRun(["rev-parse", "HEAD"])
    const git = new GitSource(executor)
    const cache = new SourceCache(input.user, git, input.signal, input.operations)
    const source = await cache.ensure({ repository, ref: commit, commit }, "测试依赖", testTask())
    await write(join(source.directory, "CMakeLists.txt"), "用户改坏了缓存")
    const registry = new ProjectRegistry(input.user, input.signal)
    const inventory = new StorageInventory(input.user, registry, git, input.signal, new ProjectStateStore(new FileTransaction(input.signal)), new CmakeService(executor, createPlatformService(executor), new IconAssetsService(input.signal), input.user))
    const maintenance = new StorageMaintenance(input.user, inventory, git, input.signal, registry)
    await input.operations.run([input.lifetime], "修复测试", () => maintenance.repair(source.key, testTask()))
    assert.equal(await readFile(join(source.directory, "CMakeLists.txt"), "utf8"), "project(Fixture NONE)\n")
    const unknownBuild = join(input.user.builds, "12345678", "xd")
    await mkdir(unknownBuild, { recursive: true })
    const uncertain = (await inventory.inspect()).find(item => item.id === `deps-src:${source.key}`)!
    assert.equal(uncertain.cleanup.allowed, false)
    assert.equal(uncertain.references.complete, false)
    await rm(join(input.user.builds, "12345678"), { recursive: true })
    const candidates = (await inventory.inspect()).filter(item => item.cleanup.allowed)
    assert.equal(candidates.length, 1)
    const peer = new OperationHost(input.user)
    const release = await peer.acquire([await canonicalResource({ ...input.lifetime, mode: "read" })], "模拟存活构建", input.signal, () => { })
    try { await assert.rejects(input.operations.run([input.lifetime], "忙资源清理", () => maintenance.clean(candidates), true), /无法稳定扫描|资源正在使用/) } finally {
        await release()
        await peer.close()
    }
    await write(join(input.user.runtime, "keep"), "运行时数据")
    await input.operations.run([input.lifetime], "清理测试", () => maintenance.clean(candidates))
    assert.deepEqual(await readdir(join(input.user.dependencySources, "entries")), [])
    assert.deepEqual(await readdir(join(input.user.dependencySources, "requests")), [])
    assert.equal(await readFile(join(input.user.runtime, "keep"), "utf8"), "运行时数据")
})

test("事务根的真实路径、别名与 Windows 短路径身份一致，恢复不误判归属", async t => {
    const input = await harness(t)
    const path = join(input.root, "file")
    const record = await input.transactions.create("write", { files: [{ path, original: null, expected: "恢复内容", written: false }] })
    const physicalRoot = await realpath(input.root)
    const alias = join(input.root, "alias")
    await symlink(physicalRoot, alias, process.platform === "win32" ? "junction" : "dir")
    const aliasedStore = new TransactionStore(alias)
    assert.equal((await aliasedStore.read(record.id)).id, record.id)
    const recovery = new RecoveryService(aliasedStore, input.operations, input.signal, input.lifetime)
    await recovery.apply(record.id, false)
    assert.equal(await readFile(path, "utf8"), "恢复内容")
})

test("初始化中断可继续或回退，用户后来添加的内容保留，修改冲突拒绝恢复", async t => {
    for (const mode of ["continue", "rollback", "conflict"]) await t.test(`恢复方式：${mode}`, async t => {
        const input = await harness(t)
        const source = join(input.root, "ui-source")
        await write(join(source, "package.json"), '{"name":"original"}\n')
        const projectRoot = join(input.root, "project")
        const state = stateFor(projectRoot)
        const controller = new AbortController()
        class InterruptedInitializer extends ProjectInitializer {
            protected override async copyDirectory(plan: CopyPlan) {
                await super.copyDirectory(plan)
                controller.abort()
            }
        }
        await assert.rejects(new InterruptedInitializer(new FileTransaction(controller.signal), controller.signal).adopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } }), { name: "AbortError" })
        const store = new TransactionStore(projectRoot)
        const records = await store.list()
        assert.equal(records.length, 1)
        assert.equal(records[0].record!.kind, "initialize")
        await write(join(projectRoot, "ui/user.txt"), "用户新增")
        const recovery = new RecoveryService(store, input.operations, input.signal, input.lifetime)
        if (mode === "conflict") {
            await write(join(projectRoot, "ui/package.json"), "用户修改")
            const plan = await recovery.plan(records[0].id)
            assert.equal(plan.continue, false)
            await assert.rejects(recovery.apply(records[0].id, false), /冲突/)
            assert.equal(await readFile(join(projectRoot, "ui/package.json"), "utf8"), "用户修改")
        } else {
            await recovery.apply(records[0].id, mode === "rollback")
            if (mode === "continue") assert.ok(await readFile(join(projectRoot, "arrange.project.yaml"), "utf8"))
            else await assert.rejects(readFile(join(projectRoot, "ui/package.json")), { code: "ENOENT" })
            assert.deepEqual(await store.list(), [])
        }
        assert.equal(await readFile(join(projectRoot, "ui/user.txt"), "utf8"), "用户新增")
    })
})
