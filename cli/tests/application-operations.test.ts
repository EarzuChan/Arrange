import assert from "node:assert/strict"
import test from "node:test"
import { dirname, join } from "node:path"
import { rm } from "node:fs/promises"
import { ApplicationOperations } from "../src/operation/ApplicationOperations.ts"
import { ProjectOperations, type ProjectAccess } from "../src/operation/ProjectOperations.ts"
import { OperationHost } from "../src/operation/OperationHost.ts"
import { Operations } from "../src/operation/Operations.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { CmakeService } from "../src/cmake/CmakeService.ts"
import { Executor } from "../src/platform/Executor.ts"
import { createPlatformService } from "../src/platform/CreatePlatformService.ts"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { UserDirectories } from "../src/user/UserDirectories.ts"
import { ResourcePlanChanged } from "../src/util/ResourcePlanChanged.ts"
import { fixture } from "./fixture.ts"
import { ProjectInitializer } from "../src/project/ProjectInitializer.ts"

test("两个 create 计划竞争同一目录，仅一个应用成功，后者重检而不覆盖", async t => {
    const state = await fixture(t, false)
    const root = join(state.rootDir, "new-project")
    const user = new UserDirectories(`${state.rootDir}-user`)
    const firstHost = new OperationHost(user)
    const secondHost = new OperationHost(user)
    t.after(async () => {
        await firstHost.close()
        await secondHost.close()
        await rm(user.root, { recursive: true, force: true })
    })
    const initializer = new ProjectInitializer(new FileTransaction())
    const request = { rootDir: root, projectName: "ConcurrentPlugin", projectVersion: "1.0.0", frameworkVersion: "0.0.0-m.3.0", vendorName: "Fixture", vendorCode: "Test", pluginCode: "Cncr", pluginType: "effect" as const, packageManager: "npm" as const, products: ["standalone" as const], uiDirectory: "ui", nativeDirectory: "native", artifactsDirectory: "artifacts", managedItems: {} }
    const firstPlan = await initializer.planCreate(request)
    const secondPlan = await initializer.planCreate(request)
    const unusedProjects = {} as ProjectOperations
    const first = new ApplicationOperations(new Operations(firstHost, new AbortController().signal, () => { }), unusedProjects)
    const second = new ApplicationOperations(new Operations(secondHost, new AbortController().signal, () => { }), unusedProjects)
    const results = await Promise.allSettled([first.initialize(initializer, firstPlan), second.initialize(initializer, secondPlan)])
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
    const failure = results.find(result => result.status === "rejected") as PromiseRejectedResult
    assert.match(String(failure.reason), /发生变化|已存在/)
    assert.equal((await new ProjectStateStore(new FileTransaction()).load(root)).project.project.name, "ConcurrentPlugin")
})

test("命令资源计划覆盖连续 build/pack、dev 使用期、sync 两范围及初始化写入", async t => {
    const state = await fixture(t, false)
    const accesses: ProjectAccess[] = []
    const projectOperations = {
        run: async (_root: string, access: ProjectAccess, _label: string, body: () => Promise<unknown>) => {
            accesses.push(access)
            return body()
        }
    } as unknown as ProjectOperations
    let initialized = false
    const operations = {
        run: async (resources: { path: string }[], _label: string, body: () => Promise<unknown>) => {
            assert.ok(resources.some(resource => resource.path === state.rootDir))
            initialized = true
            return body()
        }
    } as unknown as Operations
    const actions = new ApplicationOperations(operations, projectOperations)
    const builder = { build: async () => ({ kind: "unpacked" }) } as unknown as Parameters<ApplicationOperations["build"]>[0]
    await actions.build(builder, state.rootDir, { flavor: "release", ui: true, native: true })
    assert.equal(accesses.at(-1)!.artifacts, "write")
    assert.equal(accesses.at(-1)!.ui, "write")
    assert.equal(accesses.at(-1)!.native, "write")
    await actions.build(builder, state.rootDir, { flavor: "debug", ui: false, native: true, pack: false })
    assert.equal(accesses.at(-1)!.ui, undefined)
    assert.deepEqual(accesses.at(-1)!.flavors, ["debug"])
    const dev = { run: async () => 0 } as unknown as Parameters<ApplicationOperations["dev"]>[0]
    await actions.dev(dev, state.rootDir, { flavor: "debug", ui: true, native: true })
    assert.equal(accesses.at(-1)!.liveServer, true)
    assert.equal(accesses.at(-1)!.artifacts, undefined)
    await actions.dev(dev, state.rootDir, { flavor: "release", ui: false, native: true })
    assert.equal(accesses.at(-1)!.artifacts, "write")
    assert.equal(accesses.at(-1)!.ui, "write")
    const sync = { run: async () => ({ status: "completed" }) } as unknown as Parameters<ApplicationOperations["sync"]>[0]
    await actions.sync(sync, { setupOnly: true, nativeOnly: true }, state.rootDir)
    assert.equal(accesses.at(-1)!.configuration, "write")
    assert.equal(accesses.at(-1)!.native, "write")
    assert.equal(accesses.at(-1)!.ui, undefined)
    await actions.sync(sync, { scanOnly: true }, state.rootDir)
    assert.equal(accesses.at(-1)!.observe, true)
    assert.equal(accesses.at(-1)!.native, "read")
    await actions.initialize({ apply: async () => state } as unknown as Parameters<ApplicationOperations["initialize"]>[0], { state, files: [], guards: [], copies: [], icons: [] })
    assert.equal(initialized, true)
})

test("取得资源后重读配置，SETUP 改变资源位置时释放整组并重新规划", async t => {
    const state = await fixture(t, false)
    state.local = { native: { generator: "Ninja", architecture: "arm64" } }
    const store = new ProjectStateStore(new FileTransaction())
    await store.save(state)
    const user = new UserDirectories(`${state.rootDir}-user`)
    const host = new OperationHost(user)
    t.after(async () => {
        await host.close()
        await rm(user.root, { recursive: true, force: true })
    })
    const operations = new Operations(host, new AbortController().signal, () => { })
    const executor = new Executor()
    const cmake = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), user)
    const projects = new ProjectOperations(operations, store, cmake)
    let runs = 0
    await projects.run(state.rootDir, { configuration: "write", native: "write", nativeSource: "read" }, "SETUP", async () => {
        runs++
        const current = await store.load(state.rootDir)
        if (runs === 1) {
            current.local!.native!.buildRoot = join(state.rootDir, "alternate-build-root")
            await store.save(current)
            await assert.rejects(projects.assertSetup(current, "Native"), ResourcePlanChanged)
            throw new ResourcePlanChanged()
        }
        await projects.assertSetup(current, "Native")
        assert.equal(dirname(cmake.buildDirectory(current, "debug")).startsWith(current.local!.native!.buildRoot!), true)
    })
    assert.equal(runs, 2)
})
