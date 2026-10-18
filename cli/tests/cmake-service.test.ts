import { nativeState, nativeTools, hostPlatform, hostArchitecture, windowsOnly } from "./native-fixture.ts"
import { IconAssetsService } from "../src/feature/asset/IconAssetsService.ts"
import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import test from "node:test"
import { Executor } from "../src/feature/platform/Executor.ts"
import { createPlatformService } from "../src/feature/platform/CreatePlatformService.ts"
import { CmakeService, type CmakeModel } from "../src/feature/cmake/CmakeService.ts"
import { fixture, testTask, write } from "./fixture.ts"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { assertPlainDirectoryPath } from "../src/util/PlainDirectoryPath.ts"
import { isAbortError, type ProcessResult, type ProcessSpec } from "../src/feature/platform/ProcessSpec.ts"
import { PNG } from "pngjs"
import { UserDirectories } from "../src/feature/user/UserDirectories.ts"
import { BuildDirectories } from "../src/feature/cmake/BuildDirectories.ts"
import { cmakeDefinitionsFileName, nativeIconCmakeDefinitions, nativeIconDirectory } from "../src/CliMetadata.ts"

test("native build 尊重 CMake 并行环境变量，未设置时保留默认并行参数", async t => {
    const previous = process.env.CMAKE_BUILD_PARALLEL_LEVEL
    t.after(() => {
        if (previous === undefined) delete process.env.CMAKE_BUILD_PARALLEL_LEVEL
        else process.env.CMAKE_BUILD_PARALLEL_LEVEL = previous
    })
    for (const limit of [undefined, "2", "", "invalid"]) await t.test(limit === undefined ? "未设置" : `设置为 ${JSON.stringify(limit)}`, async t => {
        if (limit === undefined) delete process.env.CMAKE_BUILD_PARALLEL_LEVEL
        else process.env.CMAKE_BUILD_PARALLEL_LEVEL = limit
        const state = await nativeState(t)
        const calls: ProcessSpec[] = []
        class RecordingExecutor extends Executor {
            override async run(spec: ProcessSpec): Promise<ProcessResult> {
                if (!spec.args.includes("--build")) return super.run(spec)
                calls.push(spec)
                return { exitCode: 0, stdout: "", stderr: "", cancelled: false, timedOut: false }
            }
        }
        const executor = new RecordingExecutor()
        const service = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), new UserDirectories(join(state.rootDir, "user")))
        const model: CmakeModel = { sourceDirectory: join(state.rootDir, "native"), buildDirectory: service.buildDirectory(state, "release"), configuration: "Release", platform: hostPlatform!, architecture: hostArchitecture, targets: [] }
        service.configure = async () => model
        service.readModel = async () => model
        await service.build(state, "release", ["standalone"], testTask(), true)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].command, state.local!.cmake!.path)
        assert.equal(calls[0].cwd, state.rootDir)
        // 输出经任务回调捕获，不直通终端
        assert.equal(typeof calls[0].onOutput, "function")
        assert.deepEqual(calls[0].args, ["--build", model.buildDirectory, "--config", "Release", ...(limit === undefined ? ["--parallel"] : []), "--target", "TestPlugin_Standalone", "--clean-first"])
        assert.equal(process.env.CMAKE_BUILD_PARALLEL_LEVEL, limit)
    })
})

test("CMake 工具退出码为零时，取消仍以 AbortError 传出", async t => {
    class CancelledExecutor extends Executor {
        override async run(): Promise<ProcessResult> {
            return { exitCode: 0, stdout: "", stderr: "", cancelled: true, timedOut: false }
        }
    }
    const state = await fixture(t, false)
    state.local = structuredClone((await nativeTools()).local)
    const executor = new CancelledExecutor()
    const service = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), new UserDirectories(join(state.rootDir, "user")))
    state.local!.native!.buildRoot = join(tmpdir(), "a")
    await assert.rejects(service.configure(state, "debug", testTask()), isAbortError)
    assert.equal((await service.inspect(state, "debug")).ready, false)
    service.configure = async () => ({ sourceDirectory: state.rootDir, buildDirectory: service.buildDirectory(state, "debug"), configuration: "Debug", platform: hostPlatform!, architecture: hostArchitecture, targets: [] })
    await assert.rejects(service.build(state, "debug", ["standalone"], testTask()), isAbortError)
})

test("Windows 真实 CMake 取消后用大小写不同的工程路径重试，保留同一构建树", windowsOnly, async t => {
    const state = await nativeState(t)
    const native = join(state.rootDir, "native")
    await write(join(native, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Test LANGUAGES C CXX)
if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/pause")
    message(STATUS "ARRANGE_PAUSE_READY")
    execute_process(COMMAND "\${CMAKE_COMMAND}" -E sleep 60)
endif()
add_library(TestPlugin STATIC plugin.cpp)
add_executable(TestPlugin_Standalone main.cpp)
add_library(TestPlugin_VST3 MODULE plugin.cpp)
target_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)
target_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)
`)
    await write(join(native, "plugin.cpp"), "int plugin(){ return 0; }\n")
    await write(join(native, "main.cpp"), "int plugin(); int main(){ return plugin(); }\n")
    class CancellingExecutor extends Executor {
        cancel = false
        override run(spec: ProcessSpec): Promise<ProcessResult> {
            if (!this.cancel || !spec.args.includes("-S")) return super.run(spec)
            this.cancel = false
            const controller = new AbortController()
            return super.run({
                ...spec, signal: controller.signal, onOutput: (chunk, stream) => {
                    spec.onOutput?.(chunk, stream)
                    if (chunk.toString().includes("ARRANGE_PAUSE_READY")) controller.abort()
                }
            })
        }
    }
    const executor = new CancellingExecutor()
    const service = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), new UserDirectories(join(state.rootDir, "user")))
    await service.configure(state, "debug", testTask())
    const sentinel = join(service.buildDirectory(state, "debug"), "preserve-after-cancel")
    await write(sentinel, "incremental tree")
    await write(join(native, "pause"), "pause")
    executor.cancel = true
    await assert.rejects(service.configure(state, "debug", testTask()), isAbortError)
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await rm(join(native, "pause"))
    state.rootDir = state.rootDir.toUpperCase()
    const task = testTask()
    const model = await service.configure(state, "debug", task)
    assert.ok(!task.stages.includes('配置'))
    assert.equal(task.stages.at(-1), undefined)
    assert.equal(model.configuration, "Debug")
    assert.equal((await service.inspect(state, "debug")).ready, true)
    assert.equal(await readFile(sentinel, "utf8"), "incremental tree")
})

test("CMake 在读取、重置或启动工具前拒绝工作目录的符号链接", async t => {
    for (const level of ["builds", "project", "configuration"]) await t.test(`链接所在层级：${level}`, async t => {
        const state = await nativeState(t)
        const external = await mkdtemp(join(tmpdir(), "arrange-external-build-"))
        t.after(() => rm(external, { recursive: true, force: true }))
        await write(join(external, "CMakeCache.txt"), "CMAKE_GENERATOR:INTERNAL=Other\n")
        await write(join(external, "keep"), "outside project")
        const root = await mkdtemp(join(tmpdir(), "a"))
        t.after(() => rm(root, { recursive: true, force: true }))
        const user = new UserDirectories(root)
        delete state.local!.native!.buildRoot
        const paths = new BuildDirectories(hostPlatform!, user)
        const directory = paths.directory(state, "debug")
        const alias = level === "builds" ? user.builds : level === "project" ? dirname(directory) : directory
        await mkdir(dirname(alias), { recursive: true })
        await symlink(external, alias, process.platform === "win32" ? "junction" : "dir")
        const executor = new Executor()
        const service = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), user)
        const inspected = await service.inspect(state, "debug")
        assert.equal(inspected.ready, false)
        assert.match(inspected.reason!, /符号链接/)
        await assert.rejects(service.readModel(state, "debug"), /符号链接/)
        await assert.rejects(service.configure(state, "debug", testTask()), /符号链接/)
        await assert.rejects(service.build(state, "debug", ["standalone"], testTask()), /符号链接/)
        assert.equal(await readFile(join(external, "keep"), "utf8"), "outside project")
        assert.equal(await readFile(join(external, "CMakeCache.txt"), "utf8"), "CMAKE_GENERATOR:INTERNAL=Other\n")
    })
})

test("工作目录允许工程根别名，但拒绝越界路径和文件", async t => {
    const state = await fixture(t, false)
    const alias = `${state.rootDir}-alias`
    await symlink(state.rootDir, alias, process.platform === "win32" ? "junction" : "dir")
    t.after(() => rm(alias, { force: true }))
    await assertPlainDirectoryPath(alias, join(alias, "user/builds/project/mac-ad"))
    await assert.rejects(assertPlainDirectoryPath(state.rootDir, dirname(state.rootDir)), /超出工程根/)
    await write(join(state.rootDir, "user"), "file")
    await assert.rejects(assertPlainDirectoryPath(state.rootDir, join(state.rootDir, "user/builds/project")), /不是目录/)
})

test("真实 CMake 查询区分目标身份与产品名称，并识别配置输入变化", async t => {
    const state = await nativeState(t)
    const native = join(state.rootDir, "native")
    const source = `cmake_minimum_required(VERSION 3.24)\nproject(Test LANGUAGES C CXX)\nset(CMAKE_POSITION_INDEPENDENT_CODE ON)\nadd_library(TestPlugin STATIC plugin.cpp)\nadd_executable(TestPlugin_Standalone main.cpp)\ntarget_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)\nset_target_properties(TestPlugin_Standalone PROPERTIES OUTPUT_NAME "Visible Product")\nadd_library(TestPlugin_VST3 MODULE module.cpp)\ntarget_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)\n`
    await write(join(native, "CMakeLists.txt"), source)
    await write(join(native, "plugin.cpp"), "int plugin(){ return 0; }\n")
    await write(join(native, "main.cpp"), "int plugin(); int main(){ return plugin(); }\n")
    await write(join(native, "module.cpp"), "int plugin(); int module(){ return plugin(); }\n")
    const executor = new Executor()
    const service = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), new UserDirectories(join(state.rootDir, "user")))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const task = testTask()
    const model = await service.configure(state, "debug", task)
    assert.ok(!task.stages.includes('配置'))
    assert.equal(task.stages.at(-1), undefined)
    assert.equal((await service.inspect(state, "debug")).ready, true)
    for (const [key, value] of Object.entries({ displayName: "显示 产品", bundleId: "com.example.test", vendorName: "Other Vendor", vendorCode: "Vend", pluginCode: "Plug", version: "2.0.0" })) {
        const metadata = state.project.project as unknown as Record<string, string | undefined>
        const previous = metadata[key]
        metadata[key] = value
        assert.equal((await service.inspect(state, "debug")).ready, key === "bundleId" && hostPlatform === "win32", key)
        if (previous === undefined) delete metadata[key]
        else metadata[key] = previous
        assert.equal((await service.inspect(state, "debug")).ready, true, key)
    }
    state.local!.node = { path: "/new/node" }
    state.local!.packageManager = { path: "/new/npm" }
    state.project.framework.nodeRegistryUrl = "https://different.example.test/"
    assert.equal((await service.inspect(state, "debug")).ready, true)
    assert.equal(model.configuration, "Debug")
    const artifact = service.productArtifacts(state, model, ["standalone"])[0]!
    assert.equal(artifact.target, "TestPlugin_Standalone")
    assert.equal(artifact.paths.some(path => path.endsWith(`Visible Product${hostPlatform === "win32" ? ".exe" : ""}`)), true)
    const built = await service.build(state, "debug", ["standalone"], testTask())
    await access(service.productArtifacts(state, built, ["standalone"])[0]!.paths[0]!)
    assert.notEqual(service.buildDirectory(state, "debug"), service.buildDirectory(state, "release"))
    await write(join(native, "CMakeLists.txt"), source.replace("Visible Product", "Renamed Product"))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const refreshed = await service.build(state, "debug", ["standalone"], testTask())
    assert.equal((await service.inspect(state, "debug")).ready, true)
    assert.equal(service.productArtifacts(state, refreshed, ["standalone"])[0]!.paths.some(path => path.endsWith(`Renamed Product${hostPlatform === "win32" ? ".exe" : ""}`)), true)
    await write(join(native, "CMakeLists.txt"), "invalid cmake input")
    await assert.rejects(service.configure(state, "debug", testTask()), /configure 未成功/)
    assert.equal((await service.inspect(state, "debug")).ready, false)
    const cmakeLists = await readFile(join(native, "CMakeLists.txt"), "utf8")
    assert.equal(cmakeLists, "invalid cmake input")
    await write(join(native, "CMakeLists.txt"), source)
    state.local!.native!.generator = "Ninja Multi-Config"
    await assert.rejects(service.readModel(state, "debug"), /生成器/)
    const multi = await service.configure(state, "debug", testTask())
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
    await service.configure(state, "debug", testTask())
    const iconDirectory = join(service.buildDirectory(state, "debug"), nativeIconDirectory)
    const cacheWithIcon = await readFile(join(service.buildDirectory(state, "debug"), "CMakeCache.txt"), "utf8")
    assert.ok(cacheWithIcon.includes(`${nativeIconCmakeDefinitions.ico}:UNINITIALIZED=${join(iconDirectory, "icon.ico").replaceAll("\\", "/")}`))
    assert.equal((await service.inspect(state, "debug")).ready, true)
    png.data[0] = 0
    await writeFile(iconSource, PNG.sync.write(png))
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug", testTask())
    assert.equal((await service.inspect(state, "debug")).ready, true)
    await writeFile(join(iconDirectory, "icon.icns"), "corrupted")
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug", testTask())
    assert.equal((await service.inspect(state, "debug")).ready, true)
    delete state.project.project.icon
    assert.equal((await service.inspect(state, "debug")).ready, false)
    await service.configure(state, "debug", testTask())
    await assert.rejects(access(join(iconDirectory, "icon.ico")), { code: "ENOENT" })
    await assert.rejects(access(join(iconDirectory, "icon.icns")), { code: "ENOENT" })
    const cacheWithoutIcon = (await readFile(join(service.buildDirectory(state, "debug"), "CMakeCache.txt"), "utf8")).replaceAll("\r\n", "\n")
    assert.ok(cacheWithoutIcon.includes(`${nativeIconCmakeDefinitions.ico}:UNINITIALIZED=\n`))
    assert.ok(cacheWithoutIcon.includes(`${nativeIconCmakeDefinitions.icns}:UNINITIALIZED=\n`))
    assert.equal((await service.inspect(state, "debug")).ready, true)
    for (const key of Object.values(nativeIconCmakeDefinitions)) {
        state.local!.native!.cmakeDefinitions = { [key]: "override" }
        await assert.rejects(service.configure(state, "debug", testTask()), /不支持的 CMake 自定义选项/)
    }
    state.local = null
    assert.equal((await service.inspect(state, "debug")).ready, false)
})
