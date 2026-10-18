import assert from "node:assert/strict"
import { access, readFile, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { nativeBundleIconName, nativeIconCmakeDefinitions, nativeWindowsIconOwnershipFile } from "../src/CliMetadata.ts"
import { productIconAssetsRegion, productIconPreparationRegion } from "../src/feature/cmake/CmakeIconStuffs.ts"
import { pluginBundleIdRegion, jucePluginCluster } from "../src/feature/cmake/CmakeStuffs.ts"
import { Executor } from "../src/feature/platform/Executor.ts"
import { configureNative, cmakeRun, nativeTools, hostPlatform, windowsOnly, macOnly } from "./native-fixture.ts"
import { IconAssetsService } from "../src/feature/asset/IconAssetsService.ts"
import { PNG } from "pngjs"
import { fixture, write } from "./fixture.ts"

test("VST3 manifest 使用本机编译的 helper，特殊路径不经过 shell 且失败退出码传播", async t => {
    const state = await fixture(t, false)
    const directory = join(state.rootDir, "中文 & $(touch injected) ' (Product)")
    const build = join(directory, "build")
    await write(join(directory, "helper.cpp"), await readFile(fileURLToPath(new URL("./fixtures/manifest-helper.cpp", import.meta.url)), "utf8"))
    await write(join(directory, "CMakeLists.txt"), 'cmake_minimum_required(VERSION 3.24)\nproject(Helper LANGUAGES CXX)\nadd_executable(helper helper.cpp)\nadd_compile_options("$<$<CXX_COMPILER_ID:MSVC>:/utf-8>")\n')
    const configured = await configureNative(directory, build)
    assert.equal(configured.exitCode, 0, configured.stdout + configured.stderr)
    const compiled = await cmakeRun(["--build", build])
    assert.equal(compiled.exitCode, 0, compiled.stdout + compiled.stderr)
    const helper = join(build, hostPlatform === "win32" ? "helper.exe" : "helper")
    const output = join(directory, "Contents/Resources/moduleinfo.json")
    const script = fileURLToPath(new URL("../../cmake/WriteVst3Manifest.cmake", import.meta.url))
    const args = [`-DARRANGE_VST3_HELPER=${helper}`, `-DARRANGE_VST3_MANIFEST=${output}`, "-P", script]
    const result = await cmakeRun(args, state.rootDir)
    assert.equal(result.exitCode, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { Name: "中文 & Product" })
    await assert.rejects(access(join(state.rootDir, "injected")), { code: "ENOENT" })
    const failed = await cmakeRun(args, state.rootDir, { ARRANGE_TEST_HELPER_FAIL: "1" })
    assert.notEqual(failed.exitCode, 0)
    assert.match(failed.stderr, /7/)
})

test("CMake 参数生成契约：独立显示名，Bundle ID 按当前平台规则选择", async t => {
    const state = await fixture(t, false)
    state.project.project.displayName = "控制 台 $value"
    state.project.project.bundleId = "com.example.product"
    const executor = new Executor()
    const apple = hostPlatform === "darwin"
    const directory = join(state.rootDir, apple ? "apple" : "windows")
    const resultFile = join(directory, "metadata.txt")
    await write(join(directory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Metadata LANGUAGES NONE)
${pluginBundleIdRegion.make(state)}
function(juce_add_plugin target)
    cmake_parse_arguments(ARG "" "PRODUCT_NAME;PLUGIN_NAME;BUNDLE_ID" "" \${ARGN})
    file(WRITE "\${CMAKE_CURRENT_SOURCE_DIR}/metadata.txt" "\${ARG_PRODUCT_NAME}\\n\${ARG_PLUGIN_NAME}\\n\${ARG_BUNDLE_ID}\\n")
endfunction()
${jucePluginCluster.make(state)}
`)
    const result = await cmakeRun(["-S", directory, "-B", join(directory, "build")])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal((await readFile(resultFile, "utf8")).replaceAll("\r\n", "\n"), `控制 台 $value\n控制 台 $value\n${apple ? "com.example.product" : "com.testvendor.testplugin"}\n`)
})

test("生成的 icon CMake 对未准备资产与手工 JUCE 图标冲突明确失败", async t => {
    const { local } = await nativeTools()
    const state = await fixture(t, false)
    state.project.project.icon = "assets/icon.png"
    const executor = new Executor()
    const platform = hostPlatform === "darwin" ? "mac" : "win"
    const directory = join(state.rootDir, platform)
    await write(join(directory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES NONE)
${productIconPreparationRegion.make(state)}
`)
    const result = await cmakeRun(["-S", directory, "-B", join(directory, "build")])
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /CLI 图标资源尚未准备/)
    const conflictDirectory = join(state.rootDir, "conflict")
    await write(join(conflictDirectory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES NONE)
add_library(TestPlugin INTERFACE)
set_target_properties(TestPlugin PROPERTIES JUCE_ICON_BIG "manual.png")
${productIconAssetsRegion.make(state)}
`)
    const conflict = await cmakeRun(["-S", conflictDirectory, "-B", join(conflictDirectory, "build"), `-D${nativeIconCmakeDefinitions.icns}=prepared.icns`])
    assert.notEqual(conflict.exitCode, 0)
    assert.match(conflict.stderr, /CLI 图标与 JUCE ICON_BIG\/ICON_SMALL\s+冲突/)
})

test("Windows 分支真实 CMake 链接与 hook：RC、目录图标、移除与手工图标保留", windowsOnly, async t => {
    const { local, env } = await nativeTools()
    const ninja = local.ninja!.path
    const state = await fixture(t, false)
    const source = join(state.rootDir, "source path 中文")
    const build = join(state.rootDir, "build path 中文")
    const ico = join(state.rootDir, "icon files 中文", "icon.ico")
    const bundle = join(build, "产品 中文 名称.vst3")
    state.project.project.icon = "assets/icon.png"
    const png = new PNG({ width: 256, height: 256 })
    png.data.fill(255)
    const pngPath = join(state.rootDir, state.project.project.icon)
    await write(pngPath, "")
    await writeFile(pngPath, PNG.sync.write(png))
    const assets = await new IconAssetsService().prepare(state, join(state.rootDir, "generated"))
    assert.ok(assets)
    await write(ico, "")
    await writeFile(ico, await readFile(assets.ico))
    await write(join(source, "main.cpp"), "int main(){ return 0; }\n")
    await write(join(source, "plugin.cpp"), "int plugin(){ return 0; }\n")
    await write(join(source, "probe.cpp"), await readFile(fileURLToPath(new URL("./fixtures/windows-icon-probe.cpp", import.meta.url)), "utf8"))
    const executor = new Executor()
    const attributes = async (path: string): Promise<string> => {
        const result = await executor.run({ command: "attrib.exe", args: [path], env })
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout.slice(0, result.stdout.indexOf(":") - 1).trim()
    }
    const phase = async (signature: string, enabled: boolean, manual?: "BIG" | "SMALL"): Promise<string> => {
        if (enabled) state.project.project.icon = "assets/icon.png"
        else delete state.project.project.icon
        await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
add_executable(icon_probe probe.cpp)
add_library(TestPlugin STATIC plugin.cpp)
add_executable(TestPlugin_Standalone main.cpp)
add_library(TestPlugin_VST3 MODULE plugin.cpp)
target_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)
target_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)
set_target_properties(TestPlugin_VST3 PROPERTIES PREFIX "" SUFFIX ".vst3" LIBRARY_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/产品 中文 名称.vst3/Contents/x86_64-win")
${manual ? `set_target_properties(TestPlugin PROPERTIES JUCE_ICON_${manual} "manual.png")\n` : ""}${productIconPreparationRegion.make(state)}${productIconAssetsRegion.make(state)}
${manual ? 'target_sources(TestPlugin_Standalone PRIVATE "manual.rc")' : ""}
`)
        const configured = await cmakeRun(["-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-D${nativeIconCmakeDefinitions.ico}=${enabled ? ico.replaceAll("\\", "/") : ""}`, `-D${nativeIconCmakeDefinitions.icns}=`, `-D${nativeIconCmakeDefinitions.presentation}=${signature}`], undefined, env)
        assert.equal(configured.exitCode, 0, configured.stderr)
        const compiled = await cmakeRun(["--build", build, "--parallel", "2"], undefined, env)
        assert.equal(compiled.exitCode, 0, compiled.stdout + compiled.stderr)
        return compiled.stdout
    }
    await phase("first", true)
    assert.equal((await readFile(join(build, "arrange-icon.rc"), "utf8")).replaceAll("\r\n", "\n"), `#pragma code_page(65001)\n101 ICON "${ico.replaceAll("\\", "/")}"\n`)
    assert.deepEqual(await readFile(join(bundle, "Plugin.ico")), await readFile(ico))
    const probe = await executor.run({ command: join(build, "icon_probe.exe"), args: [join(build, "TestPlugin_Standalone.exe")], env })
    assert.equal(probe.exitCode, 0, probe.stderr)
    assert.ok(Number(probe.stdout.split(" ")[0]) > 0)
    assert.equal(await readFile(join(bundle, "desktop.ini"), "utf8"), "[.ShellClassInfo]\r\nIconResource=Plugin.ico,0\r\nIconFile=Plugin.ico\r\nIconIndex=0\r\n")
    await access(join(bundle, nativeWindowsIconOwnershipFile))
    assert.match(await attributes(join(bundle, "desktop.ini")), /H/)
    assert.match(await attributes(join(bundle, "desktop.ini")), /S/)
    assert.match(await attributes(bundle), /S/)
    png.data[0] = 0
    await writeFile(pngPath, PNG.sync.write(png))
    const changedAssets = await new IconAssetsService().prepare(state, join(state.rootDir, "generated"))
    await writeFile(ico, await readFile(changedAssets!.ico))
    const changedBuild = await phase("second", true)
    assert.match(changedBuild, /arrange-presentation\.cpp/)
    assert.equal(changedBuild.includes("plugin.cpp.obj"), false)
    assert.deepEqual(await readFile(join(bundle, "Plugin.ico")), await readFile(ico))
    const changedProbe = await executor.run({ command: join(build, "icon_probe.exe"), args: [join(build, "TestPlugin_Standalone.exe")], env })
    assert.equal(changedProbe.exitCode, 0, changedProbe.stderr)
    assert.notEqual(changedProbe.stdout, probe.stdout, "同路径图标更新必须改变 EXE 内真实 icon 资源")
    await phase("third", false)
    assert.equal((await executor.run({ command: join(build, "icon_probe.exe"), args: [join(build, "TestPlugin_Standalone.exe")], env })).exitCode, 4, "移除 CLI 图标后 EXE 不再包含受管 icon 资源")
    for (const filename of ["Plugin.ico", "desktop.ini", nativeWindowsIconOwnershipFile]) await assert.rejects(access(join(bundle, filename)), { code: "ENOENT" })
    await write(join(bundle, "Plugin.ico"), "old CLI icon")
    await write(join(bundle, nativeWindowsIconOwnershipFile), "")
    await phase("missing-ini", false)
    for (const filename of ["Plugin.ico", "desktop.ini", nativeWindowsIconOwnershipFile]) await assert.rejects(access(join(bundle, filename)), { code: "ENOENT" })
    assert.ok(!(await attributes(bundle)).includes("S"))
    for (const manual of ["BIG", "SMALL"] as const) {
        await write(join(source, "manual.rc"), `#pragma code_page(65001)\n102 ICON "${ico.replaceAll("\\", "/")}"\n`)
        await write(join(bundle, "Plugin.ico"), "manual icon")
        await write(join(bundle, "desktop.ini"), "manual ini")
        await write(join(bundle, nativeWindowsIconOwnershipFile), "")
        await phase(`manual-${manual}`, false, manual)
        assert.equal(await readFile(join(bundle, "Plugin.ico"), "utf8"), "manual icon")
        assert.equal(await readFile(join(bundle, "desktop.ini"), "utf8"), "manual ini")
        await assert.rejects(access(join(bundle, nativeWindowsIconOwnershipFile)), { code: "ENOENT" })
        assert.ok(!(await attributes(bundle)).includes("S"))
        assert.equal((await executor.run({ command: join(build, "icon_probe.exe"), args: [join(build, "TestPlugin_Standalone.exe"), "102"], env })).exitCode, 0, "手工 icon 资源仍实际存在于 EXE")
    }
})

test("跨目录产品目标在资源 hook 注册前给出 CLI 同目录限制与手工接入指引", async t => {
    const { local } = await nativeTools()
    const state = await fixture(t, false)
    const executor = new Executor()
    const platform = hostPlatform === "darwin" ? "mac" : "win"
    const source = join(state.rootDir, platform)
    await write(join(source, "main.cpp"), "int main(){ return 0; }\n")
    await write(join(source, "child", "CMakeLists.txt"), "add_executable(TestPlugin_Standalone ../main.cpp)\n")
    await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES CXX)
add_library(TestPlugin INTERFACE)
add_subdirectory(child)
${productIconAssetsRegion.make(state)}
`)
    const result = await cmakeRun(["-S", source, "-B", join(source, "build")])
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /CLI 托管产品图标资源段必须与 juce_add_plugin/)
    assert.match(result.stderr, /同一 CMake\s+目录/)
    assert.match(result.stderr, /自行维护图标接入/)
    assert.equal(result.stderr.includes("was not created in this directory"), false)
})

test("mac 成品资源进入两个真实 bundle，删除仅清 CLI 图标且显示资源变化会重新链接", macOnly, async t => {
    const { local, env } = await nativeTools()
    const ninja = local.ninja!.path
    const state = await fixture(t, false)
    const source = join(state.rootDir, "native")
    const build = join(state.rootDir, ".arrange", "build")
    const icon = join(build, "provided.icns")
    state.project.project.icon = "assets/icon.png"
    const png = new PNG({ width: 256, height: 256 })
    png.data.fill(255)
    await write(join(state.rootDir, state.project.project.icon), "")
    await writeFile(join(state.rootDir, state.project.project.icon), PNG.sync.write(png))
    const prepared = await new IconAssetsService().prepare(state, join(state.rootDir, "generated"))
    assert.ok(prepared)
    await write(icon, "")
    await writeFile(icon, await readFile(prepared.icns))
    await write(join(source, "main.cpp"), "int main(){ return 0; }\n")
    await write(join(source, "module.cpp"), "int plugin(){ return 0; }\n")
    await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
add_library(TestPlugin INTERFACE)
add_executable(TestPlugin_Standalone MACOSX_BUNDLE main.cpp)
add_library(TestPlugin_VST3 MODULE module.cpp)
set_target_properties(TestPlugin_VST3 PROPERTIES BUNDLE TRUE BUNDLE_EXTENSION vst3)
${productIconAssetsRegion.make(state)}
`)
    const executor = new Executor()
    const configure = async (signature: string, withIcon: boolean): Promise<void> => {
        const result = await cmakeRun(["-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-D${nativeIconCmakeDefinitions.icns}=${withIcon ? icon : ""}`, `-D${nativeIconCmakeDefinitions.presentation}=${signature}`])
        assert.equal(result.exitCode, 0, result.stderr)
    }
    const compile = async (): Promise<void> => {
        const result = await cmakeRun(["--build", build, "--parallel", "2"])
        assert.equal(result.exitCode, 0, result.stderr)
    }
    await configure("first", true)
    const token = join(build, "arrange-presentation.cpp")
    const modified = (await stat(token)).mtimeMs
    await configure("first", true)
    assert.equal((await stat(token)).mtimeMs, modified)
    await compile()
    for (const bundle of ["TestPlugin_Standalone.app", "TestPlugin_VST3.vst3"]) assert.deepEqual(await readFile(join(build, bundle, "Contents", "Resources", nativeBundleIconName)), await readFile(icon))
    await write(join(build, "TestPlugin_Standalone.app", "Contents", "Resources", "Manual.icns"), "manual resource")
    await configure("second", false)
    assert.match(await readFile(token, "utf8"), /"second"/)
    await compile()
    for (const bundle of ["TestPlugin_Standalone.app", "TestPlugin_VST3.vst3"]) await assert.rejects(access(join(build, bundle, "Contents", "Resources", nativeBundleIconName)), { code: "ENOENT" })
    assert.equal(await readFile(join(build, "TestPlugin_Standalone.app", "Contents", "Resources", "Manual.icns"), "utf8"), "manual resource")
})
