import assert from "node:assert/strict"
import { access, chmod, readFile, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { nativeBundleIconName, nativeIconCmakeDefinitions, nativeWindowsIconOwnershipFile } from "../src/CliMetadata.ts"
import { productIconAssetsRegion, productIconPreparationRegion } from "../src/cmake/CmakeIconStuffs.ts"
import { pluginBundleIdRegion, jucePluginCluster } from "../src/cmake/CmakeStuffs.ts"
import { Executor } from "../src/platform/Executor.ts"
import { locateTool } from "../src/platform/ToolLocator.ts"
import { fixture, write } from "./fixture.ts"

test("VST3 manifest 使用真实进程输出文件，特殊路径不经过 shell 且 helper 失败必须传播", { skip: process.platform === "win32" }, async t => {
    const cmake = await locateTool("cmake")
    if (!cmake) return t.skip("需要 CMake")
    const state = await fixture(t, false)
    const directory = join(state.rootDir, "中文 & $(touch injected) ' (Product)")
    const helper = join(directory, "manifest helper")
    const output = join(directory, "Contents/Resources/moduleinfo.json")
    const script = fileURLToPath(new URL("../../cmake/WriteVst3Manifest.cmake", import.meta.url))
    await write(helper, "#!/bin/sh\nprintf '%s' '{\"Name\":\"中文 & Product\"}'\n")
    await chmod(helper, 0o755)
    const executor = new Executor()
    const args = [`-DARRANGE_VST3_HELPER=${helper}`, `-DARRANGE_VST3_MANIFEST=${output}`, "-P", script]
    const result = await executor.run({ command: cmake, args, cwd: state.rootDir })
    assert.equal(result.exitCode, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { Name: "中文 & Product" })
    await assert.rejects(access(join(state.rootDir, "injected")), { code: "ENOENT" })
    await writeFile(helper, "#!/bin/sh\nexit 7\n")
    const failed = await executor.run({ command: cmake, args, cwd: state.rootDir })
    assert.notEqual(failed.exitCode, 0)
    assert.match(failed.stderr, /7/)
})

test("CMake 产品参数独立显示名，Bundle ID 只在 Apple 采用显式值", async t => {
    const cmake = await locateTool("cmake")
    if (!cmake) return t.skip("需要 CMake")
    const state = await fixture(t, false)
    state.project.project.displayName = "控制 台 $value"
    state.project.project.bundleId = "com.example.product"
    const executor = new Executor()
    for (const apple of [true, false]) {
        const directory = join(state.rootDir, apple ? "apple" : "windows")
        const resultFile = join(directory, "metadata.txt")
        await write(join(directory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Metadata LANGUAGES NONE)
set(APPLE ${apple ? "TRUE" : "FALSE"})
${pluginBundleIdRegion.make(state)}
function(juce_add_plugin target)
    cmake_parse_arguments(ARG "" "PRODUCT_NAME;PLUGIN_NAME;BUNDLE_ID" "" \${ARGN})
    file(WRITE "\${CMAKE_CURRENT_SOURCE_DIR}/metadata.txt" "\${ARG_PRODUCT_NAME}\\n\${ARG_PLUGIN_NAME}\\n\${ARG_BUNDLE_ID}\\n")
endfunction()
${jucePluginCluster.make(state)}
`)
        const result = await executor.run({ command: cmake, args: ["-S", directory, "-B", join(directory, "build")] })
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(await readFile(resultFile, "utf8"), `控制 台 $value\n控制 台 $value\n${apple ? "com.example.product" : "com.arrange.test.TestPlugin"}\n`)
    }
})

test("生成的 icon CMake 对未准备资产与手工 JUCE 图标冲突明确失败", async t => {
    const cmake = await locateTool("cmake")
    if (!cmake) return t.skip("需要 CMake")
    const state = await fixture(t, false)
    state.project.project.icon = "assets/icon.png"
    const executor = new Executor()
    for (const platform of ["mac", "win"]) {
        const directory = join(state.rootDir, platform)
        await write(join(directory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES NONE)
set(APPLE ${platform === "mac" ? "TRUE" : "FALSE"})
set(WIN32 ${platform === "win" ? "TRUE" : "FALSE"})
${productIconPreparationRegion.make(state)}
`)
        const result = await executor.run({ command: cmake, args: ["-S", directory, "-B", join(directory, "build")] })
        assert.notEqual(result.exitCode, 0)
        assert.match(result.stderr, /CLI 图标资源尚未准备/)
    }
    const directory = join(state.rootDir, "conflict")
    await write(join(directory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES NONE)
add_library(TestPlugin INTERFACE)
set_target_properties(TestPlugin PROPERTIES JUCE_ICON_BIG "manual.png")
${productIconAssetsRegion.make(state)}
`)
    const result = await executor.run({ command: cmake, args: ["-S", directory, "-B", join(directory, "build"), `-D${nativeIconCmakeDefinitions.icns}=prepared.icns`] })
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /CLI 图标与 JUCE ICON_BIG\/ICON_SMALL\s+冲突/)
})

test("Windows 分支真实 CMake 链接与 hook：RC、目录图标、移除与手工图标保留", { skip: process.platform === "win32" }, async t => {
    const cmake = await locateTool("cmake")
    const ninja = await locateTool("ninja")
    if (!cmake || !ninja) return t.skip("需要 CMake 与 Ninja")
    const state = await fixture(t, false)
    const source = join(state.rootDir, "source path 中文")
    const build = join(state.rootDir, "build path 中文")
    const ico = join(state.rootDir, "icon files 中文", "icon.ico")
    const fakeBin = join(state.rootDir, "fake-bin")
    const attribLog = join(state.rootDir, "attrib.jsonl")
    const bundle = join(build, "产品 中文 名称.vst3")
    await write(ico, "first ico bytes")
    await write(join(source, "main.cpp"), "int main(){ return 0; }\n")
    await write(join(source, "plugin.cpp"), "int plugin(){ return 0; }\n")
    await write(join(fakeBin, "attrib"), `#!/usr/bin/env node\nimport { appendFileSync, existsSync } from 'node:fs'\nappendFileSync(${JSON.stringify(attribLog)}, JSON.stringify(process.argv.slice(2))+'\\n')\nif (!existsSync(process.argv.at(-1))) process.exit(1)\n`)
    await chmod(join(fakeBin, "attrib"), 0o755)
    const executor = new Executor()
    const env = { PATH: `${fakeBin}:${process.env.PATH}` }
    const phase = async (signature: string, enabled: boolean, manual?: "BIG" | "SMALL"): Promise<string> => {
        if (enabled) state.project.project.icon = "assets/icon.png"
        else delete state.project.project.icon
        await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(APPLE FALSE)
set(WIN32 TRUE)
add_library(TestPlugin STATIC plugin.cpp)
add_executable(TestPlugin_Standalone main.cpp)
add_library(TestPlugin_VST3 MODULE plugin.cpp)
target_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)
target_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)
set_target_properties(TestPlugin_VST3 PROPERTIES LIBRARY_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/产品 中文 名称.vst3/Contents/x86_64-win")
${manual ? `set_target_properties(TestPlugin PROPERTIES JUCE_ICON_${manual} "manual.png")\n` : ""}${productIconPreparationRegion.make(state)}${productIconAssetsRegion.make(state)}
`)
        const configured = await executor.run({ command: cmake, args: ["-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-D${nativeIconCmakeDefinitions.ico}=${enabled ? ico : ""}`, `-D${nativeIconCmakeDefinitions.icns}=`, `-D${nativeIconCmakeDefinitions.presentation}=${signature}`], env })
        assert.equal(configured.exitCode, 0, configured.stderr)
        const compiled = await executor.run({ command: cmake, args: ["--build", build, "--parallel", "2"], env })
        assert.equal(compiled.exitCode, 0, compiled.stderr)
        return compiled.stdout
    }
    await phase("first", true)
    assert.equal(await readFile(join(build, "arrange-icon.rc"), "utf8"), `#pragma code_page(65001)\n101 ICON "${ico}"\n`)
    assert.equal(await readFile(join(bundle, "Plugin.ico"), "utf8"), "first ico bytes")
    assert.equal(await readFile(join(bundle, "desktop.ini"), "utf8"), "[.ShellClassInfo]\r\nIconResource=Plugin.ico,0\r\nIconFile=Plugin.ico\r\nIconIndex=0\r\n")
    await access(join(bundle, nativeWindowsIconOwnershipFile))
    const attributes = (await readFile(attribLog, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[])
    assert.deepEqual(attributes.map(args => args.slice(0, -1)), [["+s", "+h"], ["+s"]])
    assert.deepEqual(attributes.map(args => resolve(args.at(-1)!)), [join(bundle, "desktop.ini"), bundle])
    await write(ico, "changed ico bytes")
    const changedBuild = await phase("second", true)
    assert.match(changedBuild, /arrange-presentation\.cpp/)
    assert.equal(changedBuild.includes("plugin.cpp.o"), false)
    assert.equal(await readFile(join(bundle, "Plugin.ico"), "utf8"), "changed ico bytes")
    await phase("third", false)
    for (const filename of ["Plugin.ico", "desktop.ini", nativeWindowsIconOwnershipFile]) await assert.rejects(access(join(bundle, filename)), { code: "ENOENT" })
    await write(join(bundle, "Plugin.ico"), "old CLI icon")
    await write(join(bundle, nativeWindowsIconOwnershipFile), "")
    await writeFile(attribLog, "")
    await phase("missing-ini", false)
    for (const filename of ["Plugin.ico", "desktop.ini", nativeWindowsIconOwnershipFile]) await assert.rejects(access(join(bundle, filename)), { code: "ENOENT" })
    const missingIniAttributes = (await readFile(attribLog, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[])
    assert.deepEqual(missingIniAttributes.map(args => args.slice(0, -1)), [["-s"]])
    assert.equal(resolve(missingIniAttributes[0]!.at(-1)!), bundle)
    for (const manual of ["BIG", "SMALL"] as const) {
        await write(join(bundle, "Plugin.ico"), "manual icon")
        await write(join(bundle, "desktop.ini"), "manual ini")
        await write(join(bundle, nativeWindowsIconOwnershipFile), "")
        await writeFile(attribLog, "")
        await phase(`manual-${manual}`, false, manual)
        assert.equal(await readFile(join(bundle, "Plugin.ico"), "utf8"), "manual icon")
        assert.equal(await readFile(join(bundle, "desktop.ini"), "utf8"), "manual ini")
        await assert.rejects(access(join(bundle, nativeWindowsIconOwnershipFile)), { code: "ENOENT" })
        assert.equal(await readFile(attribLog, "utf8"), "")
    }
})

test("跨目录产品目标在资源 hook 注册前给出 CLI 同目录限制与手工接入指引", async t => {
    const cmake = await locateTool("cmake")
    if (!cmake) return t.skip("需要 CMake")
    const state = await fixture(t, false)
    const executor = new Executor()
    for (const platform of ["mac", "win"]) {
        const source = join(state.rootDir, platform)
        await write(join(source, "main.cpp"), "int main(){ return 0; }\n")
        await write(join(source, "child", "CMakeLists.txt"), "add_executable(TestPlugin_Standalone ../main.cpp)\n")
        await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Icon LANGUAGES CXX)
set(APPLE ${platform === "mac" ? "TRUE" : "FALSE"})
set(WIN32 ${platform === "win" ? "TRUE" : "FALSE"})
add_library(TestPlugin INTERFACE)
add_subdirectory(child)
${productIconAssetsRegion.make(state)}
`)
        const result = await executor.run({ command: cmake, args: ["-S", source, "-B", join(source, "build")] })
        assert.notEqual(result.exitCode, 0)
        assert.match(result.stderr, /CLI 托管产品图标资源段必须与 juce_add_plugin/)
        assert.match(result.stderr, /同一 CMake\s+目录/)
        assert.match(result.stderr, /自行维护图标接入/)
        assert.equal(result.stderr.includes("was not created in this directory"), false)
    }
})

test("mac 成品资源进入两个真实 bundle，删除仅清 CLI 图标且显示资源变化会重新链接", { skip: process.platform !== "darwin" }, async t => {
    const cmake = await locateTool("cmake")
    const ninja = await locateTool("ninja")
    if (!cmake || !ninja) return t.skip("需要 CMake 与 Ninja")
    const state = await fixture(t, false)
    const source = join(state.rootDir, "native")
    const build = join(state.rootDir, ".arrange", "build")
    const icon = join(build, "provided.icns")
    await write(icon, "prepared icon bytes")
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
        const result = await executor.run({ command: cmake, args: ["-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-D${nativeIconCmakeDefinitions.icns}=${withIcon ? icon : ""}`, `-D${nativeIconCmakeDefinitions.presentation}=${signature}`] })
        assert.equal(result.exitCode, 0, result.stderr)
    }
    const compile = async (): Promise<void> => {
        const result = await executor.run({ command: cmake, args: ["--build", build, "--parallel", "2"] })
        assert.equal(result.exitCode, 0, result.stderr)
    }
    await configure("first", true)
    const token = join(build, "arrange-presentation.cpp")
    const modified = (await stat(token)).mtimeMs
    await configure("first", true)
    assert.equal((await stat(token)).mtimeMs, modified)
    await compile()
    for (const bundle of ["TestPlugin_Standalone.app", "TestPlugin_VST3.vst3"]) assert.equal(await readFile(join(build, bundle, "Contents", "Resources", nativeBundleIconName), "utf8"), "prepared icon bytes")
    await write(join(build, "TestPlugin_Standalone.app", "Contents", "Resources", "Manual.icns"), "manual resource")
    await configure("second", false)
    assert.match(await readFile(token, "utf8"), /"second"/)
    await compile()
    for (const bundle of ["TestPlugin_Standalone.app", "TestPlugin_VST3.vst3"]) await assert.rejects(access(join(build, bundle, "Contents", "Resources", nativeBundleIconName)), { code: "ENOENT" })
    assert.equal(await readFile(join(build, "TestPlugin_Standalone.app", "Contents", "Resources", "Manual.icns"), "utf8"), "manual resource")
})
