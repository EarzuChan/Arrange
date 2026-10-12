import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { cmakeDefinitionsFileName, windowsObjectPathMax } from "../src/CliMetadata.ts"
import { CmakeDefinitions, mergeCmakeDefinitions, type CmakeDefinitionValues } from "../src/cmake/CmakeDefinitions.ts"
import { CmakeService } from "../src/cmake/CmakeService.ts"
import { Executor } from "../src/platform/Executor.ts"
import { createPlatformService } from "../src/platform/CreatePlatformService.ts"
import { nativeTools } from "./native-fixture.ts"
import { isAbortError, type ProcessResult, type ProcessSpec } from "../src/platform/ProcessSpec.ts"
import { UserDirectories } from "../src/user/UserDirectories.ts"
import { fixture, testTask, write } from "./fixture.ts"

test("definitions 拒绝通配键、受管选项覆盖和损坏记录，校验失败不改归属", async t => {
    const directory = await mkdtemp(join(tmpdir(), "arrange-definitions-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const definitions = new CmakeDefinitions(directory)
    assert.equal(await definitions.readKeys(), undefined)
    const invalid: CmakeDefinitionValues[] = [{ "TEST_*": "OFF" }, { CMAKE_GENERATOR: "Ninja" }, { TEST_VALUE: "line\nbreak" }]
    for (const custom of invalid) assert.throws(() => mergeCmakeDefinitions({}, custom), /不支持/)
    await definitions.begin({ TEST_VALUE: "valid" }, [])
    await assert.rejects(definitions.begin({ "TEST_*": "invalid" }, ["TEST_VALUE"]), /不支持/)
    assert.deepEqual(await definitions.readKeys(), ["TEST_VALUE"])
    for (const content of ["broken JSON", "{}", '["TEST_*"]', '["TEST_VALUE", "TEST_VALUE"]', '[null]']) {
        await write(join(directory, cmakeDefinitionsFileName), content)
        await assert.rejects(definitions.readKeys(), /归属记录损坏/)
    }
})

test("真实 CMake：删除、失败重试、取消重试、源码覆盖切换与无归属旧树重建", { timeout: 120000 }, async t => {
    class RecordingExecutor extends Executor {
        readonly calls: ProcessSpec[] = []
        cancelNext = false

        override async run(spec: ProcessSpec): Promise<ProcessResult> {
            if (!spec.args.includes("-S")) return super.run(spec)
            this.calls.push(spec)
            if (!this.cancelNext) return super.run(spec)
            this.cancelNext = false
            const controller = new AbortController()
            return super.run({
                ...spec, signal: controller.signal, onOutput: (chunk, stream) => {
                    spec.onOutput?.(chunk, stream)
                    if (chunk.toString().includes("ARRANGE_TEST_PAUSE")) controller.abort()
                }
            })
        }
    }
    const executor = new RecordingExecutor()
    const platform = createPlatformService(executor)
    const tools = await nativeTools()
    const state = await fixture(t, false)
    state.project.project.products = ["standalone"]
    state.local = tools.local
    const userRoot = await mkdtemp(join(tmpdir(), "a"))
    t.after(() => rm(userRoot, { recursive: true, force: true }))
    state.local.native!.buildRoot = userRoot
    const native = join(state.rootDir, "native")
    await write(join(native, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(DefinitionTest LANGUAGES C CXX)
option(TEST_FLAG "test flag" OFF)
set(TEST_TEXT "project-default" CACHE STRING "test text")
set(TEST_FLAG_EXTRA "neighbor-default" CACHE STRING "unowned neighbor")
if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/fail")
    message(FATAL_ERROR "ARRANGE_TEST_FAILURE")
endif()
if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/pause")
    message(STATUS "ARRANGE_TEST_PAUSE")
    execute_process(COMMAND "\${CMAKE_COMMAND}" -E sleep 60)
endif()
add_library(TestPlugin STATIC plugin.cpp)
add_executable(TestPlugin_Standalone main.cpp)
target_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)
`)
    await write(join(native, "plugin.cpp"), "int plugin() { return 0; }\n")
    await write(join(native, "main.cpp"), "int plugin(); int main() { return plugin(); }\n")
    const automatic = join(state.rootDir, "automatic-juce")
    const explicit = join(state.rootDir, "explicit-juce")
    for (const directory of [automatic, explicit]) await write(join(directory, "CMakeLists.txt"), "# test source\n")
    const sources = { prepare: async (): Promise<CmakeDefinitionValues> => state.local!.native!.cmakeDefinitions?.JUCE_DIR === undefined ? { FETCHCONTENT_SOURCE_DIR_JUCE: automatic } : {} }
    const service = new CmakeService(executor, platform, new IconAssetsService(), new UserDirectories(userRoot), sources)
    const directory = service.buildDirectory(state, "debug")
    const keys = (): Promise<readonly string[] | undefined> => new CmakeDefinitions(directory).readKeys()
    const cacheValue = async (key: string): Promise<string | undefined> => (await readFile(join(directory, "CMakeCache.txt"), "utf8")).match(new RegExp(`^${key}:[^=]+=([^\\r\\n]*)`, "m"))?.[1]
    const configure = () => service.configure(state, "debug", testTask())
    const sentinel = join(directory, "incremental-sentinel")

    await t.test("删除用户值恢复 CMake 或 CLI 默认，不删除相邻未归属键且保留构建树", async () => {
        state.local!.native!.cmakeDefinitions = { TEST_FLAG: "ON", TEST_TEXT: "override ; & $value", CMAKE_COLOR_DIAGNOSTICS: "OFF", CMAKE_OBJECT_PATH_MAX: "240" }
        await configure()
        assert.equal(await cacheValue("TEST_FLAG"), "ON")
        assert.equal(await cacheValue("TEST_TEXT"), "override ; & $value")
        const last = executor.calls.at(-1)!
        assert.equal((await executor.run({ ...last, args: [...last.args, "-DTEST_FLAG_EXTRA=keep-unowned"] })).exitCode, 0)
        await write(sentinel, "preserved")
        delete state.local!.native!.cmakeDefinitions
        assert.equal((await service.inspect(state, "debug")).ready, false)
        await configure()
        assert.equal(await cacheValue("TEST_FLAG"), "OFF")
        assert.equal(await cacheValue("TEST_TEXT"), "project-default")
        assert.equal(await cacheValue("TEST_FLAG_EXTRA"), "keep-unowned")
        assert.equal(await cacheValue("CMAKE_COLOR_DIAGNOSTICS"), "ON")
        assert.equal(await cacheValue("CMAKE_OBJECT_PATH_MAX"), process.platform === "win32" ? String(windowsObjectPathMax) : undefined)
        assert.equal(await readFile(sentinel, "utf8"), "preserved")
        assert.ok(!(await keys())!.includes("TEST_FLAG"))
        assert.equal((await service.inspect(state, "debug")).ready, true)
    })

    await t.test("连续失败保留待清理键，重试删除后恢复默认", async () => {
        state.local!.native!.cmakeDefinitions = { TEST_FLAG: "ON", TEST_TEXT: "failed-value" }
        await write(join(native, "fail"), "fail")
        await assert.rejects(configure(), /configure 未成功/)
        assert.equal(await cacheValue("TEST_FLAG"), "ON")
        delete state.local!.native!.cmakeDefinitions
        await assert.rejects(configure(), /configure 未成功/)
        assert.ok((await keys())!.includes("TEST_FLAG"))
        assert.equal((await service.inspect(state, "debug")).ready, false)
        await rm(join(native, "fail"))
        await configure()
        assert.equal(await cacheValue("TEST_FLAG"), "OFF")
        assert.equal(await cacheValue("TEST_TEXT"), "project-default")
        assert.equal(await readFile(sentinel, "utf8"), "preserved")
    })

    await t.test("真实取消后删除 definition，重试清除残值且不重建树", async () => {
        state.local!.native!.cmakeDefinitions = { TEST_FLAG: "ON", TEST_TEXT: "cancelled-value" }
        await write(join(native, "pause"), "pause")
        executor.cancelNext = true
        await assert.rejects(configure(), isAbortError)
        assert.ok((await keys())!.includes("TEST_TEXT"))
        assert.equal((await service.inspect(state, "debug")).ready, false)
        await rm(join(native, "pause"))
        delete state.local!.native!.cmakeDefinitions
        await configure()
        assert.equal(await cacheValue("TEST_TEXT"), "project-default")
        assert.equal(await cacheValue("TEST_FLAG"), "OFF")
        assert.equal(await readFile(sentinel, "utf8"), "preserved")
    })

    await t.test("自动源码转手工目录再删除手工覆盖，不残留高优先级旧路径", async () => {
        state.local!.native!.cmakeDefinitions = { JUCE_DIR: explicit }
        await configure()
        assert.equal(await cacheValue("FETCHCONTENT_SOURCE_DIR_JUCE"), undefined)
        assert.equal(await cacheValue("JUCE_DIR"), explicit)
        delete state.local!.native!.cmakeDefinitions
        await configure()
        assert.equal(await cacheValue("JUCE_DIR"), undefined)
        assert.equal(await cacheValue("FETCHCONTENT_SOURCE_DIR_JUCE"), automatic)
    })

    await t.test("缺少归属的旧树干净重建，之后 build 成功", async () => {
        await rm(join(directory, cmakeDefinitionsFileName))
        assert.equal((await service.inspect(state, "debug")).ready, false)
        await configure()
        await assert.rejects(readFile(sentinel), { code: "ENOENT" })
        assert.equal(await cacheValue("TEST_FLAG_EXTRA"), "neighbor-default")
        assert.equal((await service.inspect(state, "debug")).ready, true)
        const model = await service.build(state, "debug", ["standalone"], testTask())
        assert.ok((await readFile(service.productArtifacts(state, model, ["standalone"])[0]!.paths[0]!)).length > 0)
        await mkdir(join(directory, "keep-after-invalid-record"))
        await write(join(directory, cmakeDefinitionsFileName), '["TEST_*"]')
        await assert.rejects(configure(), /归属记录损坏/)
        assert.equal((await service.inspect(state, "debug")).ready, false)
        await readFile(join(directory, "CMakeCache.txt"))
    })
})
