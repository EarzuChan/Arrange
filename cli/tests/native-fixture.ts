import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { TestContext } from "node:test"
import { IconAssetsService } from "../src/feature/asset/IconAssetsService.ts"
import { CmakeService } from "../src/feature/cmake/CmakeService.ts"
import { Executor } from "../src/feature/platform/Executor.ts"
import { createPlatformService } from "../src/feature/platform/CreatePlatformService.ts"
import type { LocalDefinition, ProjectState } from "../src/feature/project/ProjectState.ts"
import { UserDirectories } from "../src/feature/user/UserDirectories.ts"
import { fixture, testTask, write } from "./fixture.ts"

export const hostPlatform = process.platform === "win32" || process.platform === "darwin" ? process.platform : undefined
assert.ok(hostPlatform, "原生测试只支持 Windows 和 macOS")
export const hostArchitecture = process.arch === "arm64" ? "arm64" : "x64"
export const windowsOnly = { skip: hostPlatform !== "win32" ? "不适用：仅 Windows 实机" : false }
export const macOnly = { skip: hostPlatform !== "darwin" ? "不适用：仅 macOS 实机" : false }

let discovery: Promise<{ local: LocalDefinition, env: Record<string, string> }> | undefined

// 本平台缺少工具链就是未完成验证；不能通过跳过伪装成验收成功
export function nativeTools(): Promise<{ local: LocalDefinition, env: Record<string, string> }> {
    return discovery ??= (async () => {
        const executor = new Executor()
        const platform = createPlatformService(executor)
        const found = await platform.discoverNative({})
        assert.deepEqual(found.issues, [], "本机原生工具链不可用，请准备 MSVC/Xcode、CMake 和 Ninja")
        const env = { ...await platform.nativeEnvironment(found.local), ...(platform.name === "win32" ? { VSLANG: "1033" } : {}) }
        for (const key of ["cmake", "ninja"] as const) {
            assert.ok(found.local[key]?.path, `未发现 ${key}`)
            const result = await executor.run({ command: found.local[key]!.path, args: ["--version"], env })
            assert.equal(result.exitCode, 0, result.stdout + result.stderr)
        }
        return { local: found.local, env }
    })()
}

export async function nativeState(t: Pick<TestContext, "after">): Promise<ProjectState> {
    const state = await fixture(t, false)
    const { local } = await nativeTools()
    state.local = structuredClone(local)
    const root = await mkdtemp(join(tmpdir(), "a"))
    t.after(() => rm(root, { recursive: true, force: true }))
    state.local.native!.buildRoot = root
    return state
}

export async function cmakeRun(args: readonly string[], cwd?: string, env?: Record<string, string>) {
    const tools = await nativeTools()
    return new Executor().run({ command: tools.local.cmake!.path, args, cwd, env: { ...tools.env, ...env } })
}

export async function configureNative(source: string, build: string, definitions: readonly string[] = []) {
    const { local } = await nativeTools()
    return cmakeRun(["-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${local.ninja!.path}`, "-DCMAKE_BUILD_TYPE=Release", ...definitions])
}

// 小型本机产物用于文件、打包和签名契约；JUCE 接入由独立真实工程验收
export async function nativeProducts(t: Pick<TestContext, "after">) {
    const state = await nativeState(t)
    const source = join(state.rootDir, "native")
    await write(join(source, "main.cpp"), "int plugin(); int main() { return plugin(); }\n")
    await write(join(source, "plugin.cpp"), "#if defined(_WIN32)\nextern \"C\" int effect();\nint plugin() { return effect(); }\n#else\nint plugin() { return 0; }\n#endif\n")
    await write(join(source, "effect.cpp"), "#if defined(_WIN32)\n#define EXPORT __declspec(dllexport)\n#else\n#define EXPORT\n#endif\nextern \"C\" EXPORT int effect() { return 0; }\n")
    await write(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)
project(Products LANGUAGES C CXX)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_library(TestPlugin STATIC plugin.cpp)
if(WIN32)
    add_library(Effect SHARED effect.cpp)
    add_library(Another SHARED effect.cpp)
    set_target_properties(Effect PROPERTIES OUTPUT_NAME Effect RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/library" ARCHIVE_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/library" PDB_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/library")
    set_target_properties(Another PROPERTIES OUTPUT_NAME Effect RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/another" ARCHIVE_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/another" PDB_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/another")
    target_link_libraries(TestPlugin PUBLIC Effect)
endif()
add_executable(TestPlugin_Standalone main.cpp)
add_library(TestPlugin_VST3 MODULE plugin.cpp)
target_link_libraries(TestPlugin_Standalone PRIVATE TestPlugin)
target_link_libraries(TestPlugin_VST3 PRIVATE TestPlugin)
set_target_properties(TestPlugin_Standalone PROPERTIES OUTPUT_NAME "A Product" RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/Standalone")
if(APPLE)
    set_target_properties(TestPlugin_Standalone PROPERTIES MACOSX_BUNDLE TRUE MACOSX_BUNDLE_GUI_IDENTIFIER "com.arrange.testproduct")
    set_target_properties(TestPlugin_VST3 PROPERTIES BUNDLE TRUE BUNDLE_EXTENSION vst3 PREFIX "" OUTPUT_NAME "A Product" LIBRARY_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/VST3")
    file(GENERATE OUTPUT "\${CMAKE_BINARY_DIR}/VST3/A Product.vst3/Contents/Info.plist" CONTENT [=[<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>A Product</string><key>CFBundleIdentifier</key><string>com.arrange.testproduct.vst3</string><key>CFBundlePackageType</key><string>BNDL</string></dict></plist>]=])
else()
    set_target_properties(TestPlugin_VST3 PROPERTIES PREFIX "" SUFFIX ".vst3" OUTPUT_NAME "A Product" LIBRARY_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/VST3/A Product.vst3/Contents/${hostArchitecture === "x64" ? "x86_64" : "arm64"}-win")
endif()
file(GENERATE OUTPUT "\${CMAKE_BINARY_DIR}/VST3/A Product.vst3/Contents/Resources/moduleinfo.json" CONTENT [=[{"Name":"A Product"}]=])
`)
    const executor = new Executor()
    const cmake = new CmakeService(executor, createPlatformService(executor), new IconAssetsService(), new UserDirectories(join(state.rootDir, "user")))
    const task = testTask("本机测试产物")
    let model
    try { model = await cmake.build(state, "release", ["standalone", "vst3"], task) } catch (error) { throw new Error(`${String(error)}\n${task.lines.join("\n")}`, { cause: error }) }
    return { state, cmake, model }
}

// 只复用真实编译的输入证据；副本不保留可执行构建缓存，不用于重新 configure/build
export class NativeProductSeed {
    private seed: ReturnType<typeof nativeProducts> | undefined
    private readonly cleanup: (() => unknown)[] = []

    async copy(t: TestContext) {
        this.seed ??= (async () => {
            const seed = await nativeProducts({
                after: callback => {
                    this.cleanup.push(() => callback?.(t, () => { }))
                    return undefined
                }
            })
            if (hostPlatform === "win32") {
                const result = await cmakeRun(["--build", seed.model.buildDirectory, "--target", "Another"])
                assert.equal(result.exitCode, 0, result.stdout + result.stderr)
            }
            return seed
        })()
        const seed = await this.seed
        const state = await nativeState(t)
        const build = resolve(state.local!.native!.buildRoot!, "products")
        await mkdir(build, { recursive: true })
        const relocate = (path: string): string => {
            const part = relative(seed.model.buildDirectory, path)
            if (part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))) return resolve(build, part)
            const sourcePart = relative(seed.state.rootDir, path)
            if (isAbsolute(sourcePart) || sourcePart === ".." || sourcePart.startsWith(`..${sep}`)) throw new Error(`夹具模型路径超出已知根：${path}`)
            return resolve(state.rootDir, sourcePart)
        }
        for (const name of ["Standalone", "VST3", ...(hostPlatform === "win32" ? ["library", "another"] : [])]) {
            await cp(resolve(seed.model.buildDirectory, name), resolve(build, name), { recursive: true, verbatimSymlinks: true })
        }
        const model = { ...seed.model, sourceDirectory: relocate(seed.model.sourceDirectory), buildDirectory: build, targets: seed.model.targets.map(target => ({ ...target, artifacts: target.artifacts.map(relocate) })) }
        return { state, model }
    }

    async close(): Promise<void> { for (const cleanup of this.cleanup.reverse()) await cleanup() }
}
