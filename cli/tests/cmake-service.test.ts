import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import test from "node:test"
import { Executor } from "../src/platform/Executor.ts"
import { MacPlatformService } from "../src/platform/MacPlatformService.ts"
import { CmakeService, type CmakeModel } from "../src/cmake/CmakeService.ts"
import { fixture, write } from "./fixture.ts"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { locateTool } from "../src/platform/ToolLocator.ts"
import { assertPlainDirectoryPath } from "../src/util/PlainDirectoryPath.ts"
import { isAbortError, type ProcessResult, type ProcessSpec } from "../src/platform/ProcessSpec.ts"
import { PNG } from "pngjs"
import { nativeIconCmakeDefinitions, nativeIconDirectory } from "../src/CliMetadata.ts"

test("native build 尊重 CMake 并行环境变量，未设置时保留默认并行参数", async t => {
    const previous = process.env.CMAKE_BUILD_PARALLEL_LEVEL
    t.after(() => {
        if (previous === undefined) delete process.env.CMAKE_BUILD_PARALLEL_LEVEL
        else process.env.CMAKE_BUILD_PARALLEL_LEVEL = previous
    })
    for (const limit of [undefined, "2", "", "invalid"]) await t.test(limit === undefined ? "未设置" : `设置为 ${JSON.stringify(limit)}`, async t => {
        if (limit === undefined) delete process.env.CMAKE_BUILD_PARALLEL_LEVEL
        else process.env.CMAKE_BUILD_PARALLEL_LEVEL = limit
        const state = await fixture(t, false)
        state.local = { cmake: { path: "/unused/cmake" }, nativeCompiler: { path: "/unused/clang++" }, native: { generator: "Ninja", architecture: "arm64" } }
        const calls: ProcessSpec[] = []
        class RecordingExecutor extends Executor {
            override async run(spec: ProcessSpec): Promise<ProcessResult> {
                calls.push(spec)
                return { exitCode: 0, stdout: "", stderr: "", cancelled: false, timedOut: false }
            }
        }
        const executor = new RecordingExecutor()
        const service = new CmakeService(executor, new MacPlatformService(executor), new IconAssetsService())
        const model: CmakeModel = { sourceDirectory: join(state.rootDir, "native"), buildDirectory: service.buildDirectory(state, "release"), configuration: "Release", platform: "darwin", architecture: "arm64", targets: [] }
        service.configure = async () => model
        service.readModel = async () => model
        await service.build(state, "release", ["standalone"], true)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].command, state.local.cmake!.path)
        assert.equal(calls[0].cwd, state.rootDir)
        assert.equal(calls[0].stdio, "inherit")
        assert.deepEqual(calls[0].args, ["--build", model.buildDirectory, "--config", "Release", ...(limit === undefined ? ["--parallel"] : []), "--target", "TestPlugin_Standalone", "--clean-first"])
        assert.equal(process.env.CMAKE_BUILD_PARALLEL_LEVEL, limit)
    })
})

test("CMake cancellation stays an AbortError even when a tool reports exit zero", async t => {
    class CancelledExecutor extends Executor {
        override async run(): Promise<ProcessResult> {
            return { exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }
        }
    }
    const state = await fixture(t, false)
    state.local = { cmake: { path: "/unused/cmake" }, nativeCompiler: { path: "/unused/clang++" }, native: { generator: "Unix Makefiles", architecture: "arm64" } }
    const executor = new CancelledExecutor()
    const service = new CmakeService(executor, new MacPlatformService(executor), new IconAssetsService())
    await assert.rejects(service.configure(state, "debug"), isAbortError)
    assert.equal((await service.inspect(state, "debug")).ready, false)
    service.configure = async () => ({ sourceDirectory: state.rootDir, buildDirectory: service.buildDirectory(state, "debug"), configuration: "Debug", platform: "darwin", architecture: "arm64", targets: [] })
    await assert.rejects(service.build(state, "debug", ["standalone"]), isAbortError)
})

test("CMake rejects aliased work directories before reading, resetting or running tools", async t => {
    for (const parent of [".arrange", ".arrange/build", ".arrange/build/mac-arm64", ".arrange/build/mac-arm64/debug"]) await t.test(parent, async t => {
        const state = await fixture(t, false)
        state.local = { cmake: { path: "/unused/cmake" }, nativeCompiler: { path: "/unused/clang++" }, native: { generator: "Ninja", architecture: "arm64" } }
        const external = await mkdtemp(join(tmpdir(), "arrange-external-build-"))
        t.after(() => rm(external, { recursive: true, force: true }))
        await write(join(external, "CMakeCache.txt"), "CMAKE_GENERATOR:INTERNAL=Other\n")
        await write(join(external, "keep"), "outside project")
        const alias = join(state.rootDir, parent)
        await mkdir(dirname(alias), { recursive: true })
        await symlink(external, alias, process.platform === "win32" ? "junction" : "dir")
        const executor = new Executor()
        const service = new CmakeService(executor, new MacPlatformService(executor), new IconAssetsService())
        const inspected = await service.inspect(state, "debug")
        assert.equal(inspected.ready, false)
        assert.match(inspected.reason!, /符号链接/)
        await assert.rejects(service.readModel(state, "debug"), /符号链接/)
        await assert.rejects(service.configure(state, "debug"), /符号链接/)
        await assert.rejects(service.build(state, "debug", ["standalone"]), /符号链接/)
        assert.equal(await readFile(join(external, "keep"), "utf8"), "outside project")
        assert.equal(await readFile(join(external, "CMakeCache.txt"), "utf8"), "CMAKE_GENERATOR:INTERNAL=Other\n")
    })
})

test("plain working directory permits a project-root alias and rejects escapes or files", async t => {
    const state = await fixture(t, false)
    const alias = `${state.rootDir}-alias`
    await symlink(state.rootDir, alias, process.platform === "win32" ? "junction" : "dir")
    t.after(() => rm(alias, { force: true }))
    await assertPlainDirectoryPath(alias, join(alias, ".arrange/build/mac-arm64/debug"))
    await assert.rejects(assertPlainDirectoryPath(state.rootDir, dirname(state.rootDir)), /超出工程根/)
    await write(join(state.rootDir, ".arrange"), "file")
    await assert.rejects(assertPlainDirectoryPath(state.rootDir, join(state.rootDir, ".arrange/build")), /不是目录/)
})

test("real CMake query keeps target identity separate from product name and refreshes inputs", { skip: process.platform !== "darwin" }, async t => {
    const cmakePath = await locateTool("cmake")
    const ninjaPath = await locateTool("ninja")
    if (!cmakePath || !ninjaPath) return t.skip("需要 CMake 与 Ninja")
    const state = await fixture(t, false)
    state.local = { cmake: { path: cmakePath }, ninja: { path: ninjaPath }, nativeCompiler: { path: "/usr/bin/clang++" }, native: { generator: "Ninja", architecture: process.arch === "arm64" ? "arm64" : "x64" } }
    const native = join(state.rootDir, "native")
    const source = `cmake_minimum_required(VERSION 3.24)\nproject(Test LANGUAGES C CXX)\nset(CMAKE_POSITION_INDEPENDENT_CODE ON)\nadd_library(TestPlugin STATIC plugin.cpp)\nadd_executable(TestPlugin_Standalone main.cpp)\ntarget_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)\nset_target_properties(TestPlugin_Standalone PROPERTIES OUTPUT_NAME "Visible Product")\nadd_library(TestPlugin_VST3 MODULE module.cpp)\ntarget_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)\n`
    await write(join(native, "CMakeLists.txt"), source)
    await write(join(native, "plugin.cpp"), "int plugin(){ return 0; }\n")
    await write(join(native, "main.cpp"), "int plugin(); int main(){ return plugin(); }\n")
    await write(join(native, "module.cpp"), "int plugin(); int module(){ return plugin(); }\n")
    const executor = new Executor()
    const service = new CmakeService(executor, new MacPlatformService(executor), new IconAssetsService())
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const model = await service.configure(state, "debug")
    assert.equal((await service.inspect(state, "debug")).ready, true)
    for (const [key, value] of Object.entries({ displayName: "显示 产品", bundleId: "com.example.test", vendorName: "Other Vendor", vendorCode: "Vend", pluginCode: "Plug", version: "2.0.0" })) {
        const metadata = state.project.project as unknown as Record<string, string | undefined>
        const previous = metadata[key]
        metadata[key] = value
        assert.equal((await service.inspect(state, "debug")).ready, false, key)
        if (previous === undefined) delete metadata[key]
        else metadata[key] = previous
        assert.equal((await service.inspect(state, "debug")).ready, true, key)
    }
    state.local.node = { path: "/new/node" }
    state.local.packageManager = { path: "/new/npm" }
    state.project.framework.nodeRegistryUrl = "https://different.example.test/"
    assert.equal((await service.inspect(state, "debug")).ready, true)
    assert.equal(model.configuration, "Debug")
    const artifact = service.productArtifacts(state, model, ["standalone"])[0]!
    assert.equal(artifact.target, "TestPlugin_Standalone")
    assert.equal(artifact.paths.some(path => path.endsWith("Visible Product")), true)
    const built = await service.build(state, "debug", ["standalone"])
    await access(service.productArtifacts(state, built, ["standalone"])[0]!.paths[0]!)
    assert.notEqual(service.buildDirectory(state, "debug"), service.buildDirectory(state, "release"))
    await write(join(native, "CMakeLists.txt"), source.replace("Visible Product", "Renamed Product"))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const refreshed = await service.build(state, "debug", ["standalone"])
    assert.equal((await service.inspect(state, "debug")).ready, true)
    assert.equal(service.productArtifacts(state, refreshed, ["standalone"])[0]!.paths.some(path => path.endsWith("Renamed Product")), true)
    await write(join(native, "CMakeLists.txt"), "invalid cmake input")
    await assert.rejects(service.configure(state, "debug"), /configure 未成功/)
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const cmakeLists = await readFile(join(native, "CMakeLists.txt"), "utf8")
    assert.equal(cmakeLists, "invalid cmake input")
    await write(join(native, "CMakeLists.txt"), source)
    state.local.native!.generator = "Ninja Multi-Config"
    await assert.rejects(service.readModel(state, "debug"), /生成器/)
    const multi = await service.configure(state, "debug")
    assert.equal(multi.configuration, "Debug")
    assert.equal((await service.inspect(state, "debug")).ready, true)
    await access(join(service.buildDirectory(state, "debug"), "build-Debug.ninja"))
    state.project.project.icon = "assets/icon.png"
    const png = new PNG({ width: 256, height: 256 })
    png.data.fill(255)
    const iconSource = join(state.rootDir, state.project.project.icon)
    await mkdir(dirname(iconSource), { recursive: true })
    await writeFile(iconSource, PNG.sync.write(png))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug")
    const iconDirectory = join(service.buildDirectory(state, "debug"), nativeIconDirectory)
    const cacheWithIcon = await readFile(join(service.buildDirectory(state, "debug"), "CMakeCache.txt"), "utf8")
    assert.ok(cacheWithIcon.includes(`${nativeIconCmakeDefinitions.ico}:UNINITIALIZED=${join(iconDirectory, "icon.ico")}`))
    assert.equal((await service.inspect(state, "debug")).ready, true)
    png.data[0] = 0
    await writeFile(iconSource, PNG.sync.write(png))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug")
    assert.equal((await service.inspect(state, "debug")).ready, true)
    await writeFile(join(iconDirectory, "icon.icns"), "corrupted")
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug")
    assert.equal((await service.inspect(state, "debug")).ready, true)
    delete state.project.project.icon
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug")
    await assert.rejects(access(join(iconDirectory, "icon.ico")), { code: "ENOENT" })
    await assert.rejects(access(join(iconDirectory, "icon.icns")), { code: "ENOENT" })
    const cacheWithoutIcon = await readFile(join(service.buildDirectory(state, "debug"), "CMakeCache.txt"), "utf8")
    assert.ok(cacheWithoutIcon.includes(`${nativeIconCmakeDefinitions.ico}:UNINITIALIZED=\n`))
    assert.ok(cacheWithoutIcon.includes(`${nativeIconCmakeDefinitions.icns}:UNINITIALIZED=\n`))
    assert.equal((await service.inspect(state, "debug")).ready, true)
    for (const key of Object.values(nativeIconCmakeDefinitions)) {
        state.local.native!.cmakeDefinitions = { [key]: "override" }
        await assert.rejects(service.configure(state, "debug"), /不支持的 CMake 自定义选项/)
    }
    state.local = null
    assert.equal((await service.inspect(state, "debug")).ready, false)
})
