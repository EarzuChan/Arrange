import assert from "node:assert/strict"
import { readFile, readdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { BuildService, type BuildOptions } from "../src/building/BuildService.ts"
import { DevService } from "../src/building/DevService.ts"
import { NativeBuildService } from "../src/building/NativeBuildService.ts"
import { UiBuildService } from "../src/building/UiBuildService.ts"
import type { CmakeModel, CmakeService } from "../src/cmake/CmakeService.ts"
import type { FrameworkService } from "../src/framework/FrameworkService.ts"
import type { NodeJsService } from "../src/node-js/NodeJsService.ts"
import type { ArtifactLocator } from "../src/packing/ArtifactLocator.ts"
import type { PackOptions, Packer } from "../src/packing/Packer.ts"
import type { DevSupervisor, LongRunningProcessSpec } from "../src/platform/DevSupervisor.ts"
import type { ToolchainService } from "../src/platform/ToolchainService.ts"
import type { ProjectService } from "../src/project/ProjectService.ts"
import type { BuildFlavor, LocalDefinition, NativeProduct, ProjectState } from "../src/project/ProjectState.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { SetupService } from "../src/sync/SetupService.ts"
import type { SetupScope } from "../src/sync/SetupScanReport.ts"
import type { SetupInteraction } from "../src/sync/SetupInteraction.ts"
import { fixture, write } from "./fixture.ts"

const local: LocalDefinition = { node: { path: "/tools/node", version: "26.5.0" }, packageManager: { path: "/tools/npm", version: "11.0.0" } }

async function preparedState(t: TestContext): Promise<ProjectState> {
    const state = await fixture(t, false)
    state.local = structuredClone(local)
    await new ProjectStateStore(new FileTransaction()).save(state)
    return state
}

async function setupHarness(t: TestContext) {
    const state = await preparedState(t)
    const store = new ProjectStateStore(new FileTransaction())
    const applied: string[] = []
    const tools = { inspect: async (input: ProjectState) => ({ local: input.local!, issues: [] }) } as unknown as ToolchainService
    const node = { inspect: async () => ({ ready: false, reason: "依赖未安装" }), install: async () => { applied.push("ui") } } as unknown as NodeJsService
    const cmake = { inspect: async () => ({ ready: false }), configure: async (_state: ProjectState, flavor: BuildFlavor) => { applied.push(flavor) } } as unknown as CmakeService
    const framework = { assertCompatible: async () => { } } as unknown as FrameworkService
    const messages: string[] = []
    const failures: string[] = []
    const wizard: SetupInteraction = {
        report: () => { },
        acceptTools: async () => { throw new Error("测试不应进入交互") },
        editTools: async () => { throw new Error("测试不应进入交互") },
        message: message => { messages.push(message) },
        failure: message => { failures.push(message) },
    }
    const setup = new SetupService(store, tools, node, cmake, framework, wizard, new AbortController().signal)
    return { state, store, tools, node, cmake, framework, setup, wizard, applied, messages, failures }
}

test("SETUP scan 与 --scan 仅报告动作，不保存 local、不安装或配置", async t => {
    const input = await setupHarness(t)
    const proposed = { ...local, node: { path: "/new/node", version: "26.6.0" } }
    input.tools.inspect = async () => ({ local: proposed, issues: [] })
    const before = await readdir(input.state.rootDir, { recursive: true })
    const projectText = await readFile(resolve(input.state.rootDir, "arrange.project.yaml"), "utf8")
    const localText = await readFile(resolve(input.state.rootDir, "arrange.local.yaml"), "utf8")
    const report = await input.setup.scan(input.state.rootDir, "Global")
    assert.deepEqual(report.applicable.map(task => task.kind), ["install-ui", "configure-native", "configure-native"])
    assert.equal(report.resolvable[0].key, "local-tools")
    assert.equal((await input.setup.run(input.state.rootDir, "Global", true)).status, "blocked")
    assert.deepEqual(input.applied, [])
    assert.deepEqual(await readdir(input.state.rootDir, { recursive: true }), before)
    assert.equal(await readFile(resolve(input.state.rootDir, "arrange.project.yaml"), "utf8"), projectText)
    assert.equal(await readFile(resolve(input.state.rootDir, "arrange.local.yaml"), "utf8"), localText)
})

test("SETUP 的 Framework/UI Fatal 阻止全范围所有 APPLY 和 Resolve", async t => {
    for (const fatal of ["framework", "ui"] as const) await t.test(fatal, async t => {
        const input = await setupHarness(t)
        input.tools.inspect = async () => ({ local: { ...local, node: { path: "/changed/node" } }, issues: [] })
        if (fatal === "framework") input.framework.assertCompatible = async () => { throw new Error("Framework 不兼容") }
        else input.node.inspect = async () => ({ ready: false, fatal: true, reason: "UI manifest 损坏" })
        const result = await input.setup.run(input.state.rootDir, "Global")
        assert.equal(result.status, "blocked")
        assert.equal(result.report?.fatal[0].key, fatal)
        assert.ok(result.report!.applicable.length > 0)
        assert.deepEqual(input.applied, [])
        assert.deepEqual((await input.store.load(input.state.rootDir)).local, local)
        await assert.rejects(readdir(resolve(input.state.rootDir, ".arrange")), { code: "ENOENT" })
    })
})

test("SETUP 安装取消会停止后续 native configure 并向命令入口传递取消", async t => {
    const input = await setupHarness(t)
    const cancellation = new DOMException("操作已取消", "AbortError")
    input.node.install = async () => { throw cancellation }
    await assert.rejects(input.setup.run(input.state.rootDir, "Global"), error => error === cancellation)
    assert.deepEqual(input.applied, [])
})

test("SETUP 每次 Resolve 后重载状态，安装使用确认保存后的 local", async t => {
    const input = await setupHarness(t)
    const proposed: LocalDefinition = { ...local, node: { path: "/confirmed/node", version: "26.6.0" } }
    let loads = 0
    const deepLoad = input.store.deepLoad.bind(input.store)
    input.store.deepLoad = async root => {
        loads++
        return deepLoad(root)
    }
    input.tools.inspect = async () => ({ local: proposed, issues: [] })
    let confirmations = 0
    input.wizard.acceptTools = async candidate => {
        confirmations++
        assert.deepEqual(candidate, proposed)
        assert.deepEqual(input.applied, [])
        return true
    }
    input.node.install = async state => {
        assert.ok(loads >= 2)
        assert.deepEqual(state.local, proposed)
        input.applied.push("ui")
    }
    const result = await input.setup.run(input.state.rootDir, "Global")
    assert.equal(result.status, "completed")
    assert.equal(confirmations, 1)
    assert.deepEqual(input.applied, ["ui", "debug", "release"])
    assert.deepEqual((await input.store.load(input.state.rootDir)).local, proposed)
})

test("SETUP Resolve 确认期间 YAML 改动阻止保存，APPLY 间改动阻止后续工具", async t => {
    await t.test("确认前并发修改", async t => {
        const input = await setupHarness(t)
        input.tools.inspect = async () => ({ local: { ...local, node: { path: "/changed/node" } }, issues: [] })
        input.wizard.acceptTools = async () => {
            await write(resolve(input.state.rootDir, "arrange.project.yaml"), "# 用户的新内容\n")
            return true
        }
        assert.equal((await input.setup.run(input.state.rootDir, "Global")).status, "failed")
        assert.deepEqual(input.applied, [])
        assert.equal(await readFile(resolve(input.state.rootDir, "arrange.project.yaml"), "utf8"), "# 用户的新内容\n")
        assert.deepEqual((await input.store.deepLoad(input.state.rootDir)).state, null)
    })
    await t.test("执行间并发修改", async t => {
        const input = await setupHarness(t)
        input.node.install = async () => {
            input.applied.push("ui")
            await write(resolve(input.state.rootDir, "arrange.local.yaml"), "# 用户切换工具链\n")
        }
        assert.equal((await input.setup.run(input.state.rootDir, "Global")).status, "failed")
        assert.deepEqual(input.applied, ["ui"])
    })
})

function buildHarness(state: ProjectState) {
    const scopes: SetupScope[] = []
    const calls: { kind: "ui" | "native" | "pack", products?: readonly NativeProduct[], clean?: boolean }[] = []
    const project = { load: async () => state, requireConfiguration: async (_state: ProjectState, scope: SetupScope) => { scopes.push(scope) } } as unknown as ProjectService
    const tools = { inspect: async () => ({ local: state.local!, issues: [] }) } as unknown as ToolchainService
    const ui = { build: async (_state: ProjectState, clean?: boolean) => { calls.push({ kind: "ui", clean }) } } as unknown as UiBuildService
    const native = { build: async (_state: ProjectState, _flavor: BuildFlavor, products: readonly NativeProduct[], clean?: boolean) => { calls.push({ kind: "native", products, clean }) } } as unknown as NativeBuildService
    const packer = { pack: async (_state: ProjectState, options: PackOptions) => { calls.push({ kind: "pack", products: options.products, clean: options.clean }) } } as unknown as Packer
    return { service: new BuildService(project, tools, ui, native, packer), project, tools, ui, native, packer, scopes, calls }
}

test("Build 的 UI/native 范围独立，全量默认交付、--no-package 禁止交付", async t => {
    const cases: { name: string, options: BuildOptions, scope: SetupScope, kinds: string[] }[] = [
        { name: "UI only", options: { flavor: "release", ui: true, native: false, clean: true }, scope: "UI", kinds: ["ui"] },
        { name: "native only", options: { flavor: "debug", ui: false, native: true, products: ["vst3", "vst3"] }, scope: "Native", kinds: ["native"] },
        { name: "全量默认", options: { flavor: "release", ui: true, native: true, clean: true }, scope: "Global", kinds: ["ui", "native", "pack"] },
        { name: "不交付", options: { flavor: "release", ui: true, native: true, package: false }, scope: "Global", kinds: ["ui", "native"] },
    ]
    for (const entry of cases) await t.test(entry.name, async t => {
        const state = await preparedState(t)
        const input = buildHarness(state)
        await input.service.build(state.rootDir, entry.options)
        assert.deepEqual(input.scopes, [entry.scope])
        assert.deepEqual(input.calls.map(call => call.kind), entry.kinds)
        for (const call of input.calls.filter(call => call.products)) assert.deepEqual(call.products, entry.options.products ? ["vst3"] : state.project.project.products)
        for (const call of input.calls) assert.equal(call.clean, entry.options.clean)
    })
})

test("Build 拒绝未启用产品、配置或工具变化，且失败后不进入交付", async t => {
    const state = await preparedState(t)
    state.project.project.products = ["standalone"]
    const input = buildHarness(state)
    const options = { flavor: "release", ui: true, native: true } as const
    await assert.rejects(input.service.build(state.rootDir, { ...options, products: ["vst3"] }), /所选产品/)
    assert.deepEqual(input.scopes, [])
    input.tools.inspect = async () => ({ local: { ...local, node: { path: "/different/node" } }, issues: [] })
    await assert.rejects(input.service.build(state.rootDir, options), /本机工具/)
    assert.deepEqual(input.calls, [])
    input.tools.inspect = async () => ({ local: state.local!, issues: [] })
    input.ui.build = async () => { throw new Error("UI 构建失败") }
    await assert.rejects(input.service.build(state.rootDir, options), /UI 构建失败/)
    assert.deepEqual(input.calls, [])
})

test("UI/native 同版本重建失败使旧成功 receipt 作废，构建期间也不保留 completed", async t => {
    const state = await preparedState(t)
    const model: CmakeModel = { sourceDirectory: resolve(state.rootDir, "native"), buildDirectory: resolve(state.rootDir, ".arrange/build"), configuration: "Release", platform: "darwin", architecture: "arm64", targets: [] }
    for (const kind of ["ui", "native-release"] as const) await t.test(kind, async () => {
        const receiptPath = resolve(state.rootDir, ".arrange", `built-${kind}.json`)
        let fail = false
        const compile = async () => {
            assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).status, "building")
            if (fail) throw new Error("模拟编译错误")
        }
        const ui = new UiBuildService({
            build: async () => {
                await compile()
                return resolve(state.rootDir, "ui/dist")
            }
        } as unknown as NodeJsService)
        const native = new NativeBuildService({
            build: async () => {
                await compile()
                return model
            }
        } as unknown as CmakeService)
        const build = () => kind === "ui" ? ui.build(state) : native.build(state, "release", ["standalone"])
        await build()
        const completed = JSON.parse(await readFile(receiptPath, "utf8"))
        assert.equal(completed.status, "completed")
        assert.equal(completed.projectVersion, state.project.project.version)
        fail = true
        await assert.rejects(build(), /模拟编译错误/)
        const failed = JSON.parse(await readFile(receiptPath, "utf8"))
        assert.equal(failed.status, "failed")
        assert.equal(failed.projectVersion, completed.projectVersion)
        assert.equal(failed.frameworkVersion, completed.frameworkVersion)
        assert.equal(failed.path, undefined)
        assert.equal(failed.configuration, undefined)
    })
})

async function devHarness(t: TestContext) {
    const state = await preparedState(t)
    const nativeBinary = resolve(state.rootDir, ".arrange/Standalone")
    const packedBinary = resolve(state.rootDir, "artifacts/Standalone")
    await write(nativeBinary, "native")
    await write(packedBinary, "packed")
    const scopes: SetupScope[] = []
    const builds: string[] = []
    const packages: PackOptions[] = []
    const actions: string[] = []
    let processes: readonly LongRunningProcessSpec[] = []
    const project = { load: async () => state, requireConfiguration: async (_state: ProjectState, scope: SetupScope) => { scopes.push(scope) } } as unknown as ProjectService
    const tools = { inspect: async () => ({ local: state.local!, issues: [] }) } as unknown as ToolchainService
    const node = { inspect: async () => ({ ready: true }), packageManagerSpec: () => ({ command: "/tools/npm", args: ["run", "dev"] }) } as unknown as NodeJsService
    const cmake = { inspect: async () => ({ ready: true }) } as unknown as CmakeService
    const native = {
        build: async (_state: ProjectState, _flavor: BuildFlavor, products: readonly NativeProduct[]) => {
            assert.deepEqual(products, ["standalone"])
            builds.push("native")
            actions.push("native-build")
            await write(nativeBinary, "rebuilt")
        }
    } as unknown as NativeBuildService
    const artifacts = {
        locateStandalone: async () => {
            actions.push("locate")
            return { binaryPath: nativeBinary }
        }
    } as unknown as ArtifactLocator
    const supervisor = {
        run: async (specs: readonly LongRunningProcessSpec[]) => {
            actions.push("launch")
            processes = specs
            return 7
        }
    } as unknown as DevSupervisor
    const ui = {
        build: async () => {
            builds.push("ui")
            actions.push("ui-build")
        }
    } as unknown as UiBuildService
    const packer = {
        pack: async (_state: ProjectState, options: PackOptions) => {
            actions.push("pack")
            packages.push(options)
            await write(packedBinary, await readFile(nativeBinary, "utf8"))
            return { products: [{ binaryPath: packedBinary }] }
        }
    } as unknown as Packer
    return { state, node, cmake, native, artifacts, ui, packer, builds, packages, actions, scopes, nativeBinary, packedBinary, processes: () => processes, service: new DevService(project, tools, node, cmake, native, artifacts, supervisor, ui, packer) }
}

test("Release dev 先构建 UI 并交付 Standalone，运行交付二进制；native-only 使用已有 UI", async t => {
    for (const entry of [{ flavor: "release", ui: true }, { flavor: "debug", ui: false }, { flavor: "release", ui: false }] as const) await t.test(`${entry.flavor} ui=${entry.ui}`, async t => {
        const input = await devHarness(t)
        input.node.inspect = async () => { throw new Error("本模式不应启动 Vite") }
        const code = await input.service.run(input.state.rootDir, { ...entry, native: true })
        assert.equal(code, 7)
        assert.deepEqual(input.builds, entry.ui ? ["native", "ui"] : ["native"])
        assert.deepEqual(input.packages, [{ flavor: entry.flavor, products: ["standalone"] }])
        assert.deepEqual(input.processes().map(process => process.name), ["native"])
        assert.equal(input.processes()[0].command, input.packedBinary)
        assert.deepEqual(input.processes()[0].dependsOn, [])
    })
})

test("Debug Live 无需 UI dist 或预编译，在真实模块协议就绪后运行增量 native", async t => {
    const input = await devHarness(t)
    await rm(input.packedBinary)
    await rm(resolve(input.state.rootDir, "ui/dist"), { recursive: true, force: true })
    input.ui.build = async () => { throw new Error("Live UI 和资源由 Framework 当前 origin 提供，不应预编译 UI") }
    input.packer.pack = async () => { throw new Error("Debug Live 不应依赖 package") }
    assert.equal(await input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true }), 7)
    assert.deepEqual(input.builds, ["native"])
    assert.deepEqual(input.packages, [])
    assert.deepEqual(input.actions, ["native-build", "locate", "launch"])
    const ui = input.processes().find(process => process.name === "ui")!
    const native = input.processes().find(process => process.name === "native")!
    assert.deepEqual(native.dependsOn, ["ui"])
    assert.equal(native.command, input.nativeBinary)
    assert.match(ui.readyUrl!, /\/@arrange\/modules$/)
    assert.equal(await ui.readyCheck!(new Response("<html>其它服务</html>", { headers: { "Content-Type": "text/html" } })), false)
    for (const body of [{}, { entry: "/src/App.sfa", modules: [] }, { entry: "/src/App.sfa", modules: [{ url: "/module" }] }]) assert.equal(await ui.readyCheck!(Response.json(body)), false)
    assert.equal(await ui.readyCheck!(Response.json({ entry: "/src/App.sfa", modules: [{ url: "/src/App.sfa", source: "export default {}" }] })), true)
})

test("Dev 缺失 Standalone 时只编译所需产品；未准备 UI/native 阻止启动", async t => {
    const input = await devHarness(t)
    await rm(input.nativeBinary)
    await input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true })
    assert.deepEqual(input.builds, ["native"])
    input.node.inspect = async () => ({ ready: false, reason: "依赖缺失" })
    await assert.rejects(input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true }), /依赖缺失/)
    input.node.inspect = async () => ({ ready: true })
    input.cmake.inspect = async () => ({ ready: false, reason: "native 过期" })
    await assert.rejects(input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true }), /native 过期/)
    assert.deepEqual(input.builds, ["native"])
})

test("Dev 已有同名 binary 仍增量构建 Standalone，使源码变更进入运行产物", async t => {
    const input = await devHarness(t)
    await write(resolve(input.state.rootDir, "native/Source/changed.cpp"), "// 新增的用户实现\n")
    assert.equal(await readFile(input.nativeBinary, "utf8"), "native")
    await input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true })
    assert.deepEqual(input.builds, ["native"])
    assert.equal(await readFile(input.nativeBinary, "utf8"), "rebuilt")
    assert.equal(await readFile(input.packedBinary, "utf8"), "packed")
    assert.equal(input.processes().find(process => process.name === "native")!.command, input.nativeBinary)
})

test("Release dev 的 UI 构建或打包失败时不启动 native", async t => {
    for (const stage of ["ui", "pack"] as const) await t.test(stage, async t => {
        const input = await devHarness(t)
        if (stage === "ui") input.ui.build = async () => { throw new Error("UI 构建失败") }
        else input.packer.pack = async () => { throw new Error("UI 资源交付失败") }
        await assert.rejects(input.service.run(input.state.rootDir, { flavor: "release", ui: true, native: true }), stage === "ui" ? /UI 构建失败/ : /UI 资源交付失败/)
        assert.deepEqual(input.builds, stage === "ui" ? ["native"] : ["native", "ui"])
        assert.deepEqual(input.packages, [])
        assert.deepEqual(input.processes(), [])
        assert.ok(!input.actions.includes("launch"))
    })
})

test("Debug native 构建或定位失败时不启动 Live server/native", async t => {
    for (const stage of ["build", "locate"] as const) await t.test(stage, async t => {
        const input = await devHarness(t)
        if (stage === "build") input.native.build = async () => { throw new Error("native 构建失败") }
        else input.artifacts.locateStandalone = async () => { throw new Error("Standalone 产物缺失") }
        await assert.rejects(input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: true }), stage === "build" ? /native 构建失败/ : /Standalone 产物缺失/)
        assert.deepEqual(input.builds, stage === "build" ? [] : ["native"])
        assert.deepEqual(input.packages, [])
        assert.deepEqual(input.processes(), [])
        assert.ok(!input.actions.includes("launch"))
    })
})

test("UI-only dev 只启动模块协议服务器，不构建或准备 native bundle", async t => {
    const input = await devHarness(t)
    input.cmake.inspect = async () => { throw new Error("UI-only 不应检查 native") }
    assert.equal(await input.service.run(input.state.rootDir, { flavor: "debug", ui: true, native: false }), 7)
    assert.deepEqual(input.scopes, ["UI"])
    assert.deepEqual(input.builds, [])
    assert.deepEqual(input.packages, [])
    assert.deepEqual(input.actions, ["launch"])
    assert.deepEqual(input.processes().map(process => process.name), ["ui"])
})
