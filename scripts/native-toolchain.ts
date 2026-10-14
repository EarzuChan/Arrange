import { dirname, join, resolve } from "node:path"
import { mkdir, realpath } from "node:fs/promises"
import { Executor } from "../cli/src/platform/Executor.ts"
import { createPlatformService } from "../cli/src/platform/CreatePlatformService.ts"
import { locateTool } from "../cli/src/platform/ToolLocator.ts"
import { windowsObjectPathMax } from "../cli/src/CliMetadata.ts"
import { repoRoot } from "./common.ts"
import { NativeBuildTree } from "../cli/src/cmake/NativeBuildTree.ts"
import { cachedNativeDefinitions } from "./native-source-cache.ts"
import { BuildReferences } from "../cli/src/source/BuildReferences.ts"
import { claimNativeVerification, nativeSessionRun, currentNativeSession } from "./native-session.ts"

let discovery: ReturnType<typeof discover> | undefined

async function discover() {
    const executor = new Executor()
    const platform = createPlatformService(executor)
    const found = await platform.discoverNative({
        ...(process.env.CMAKE_EXE ? { cmake: { path: process.env.CMAKE_EXE } } : {}),
        ...(process.env.NINJA_EXE ? { ninja: { path: process.env.NINJA_EXE } } : {}),
        native: { generator: "Ninja", architecture: process.arch === "arm64" ? "arm64" : "x64", ...(process.env.VSDEVCMD ? { developerCommand: process.env.VSDEVCMD } : {}) },
    })
    if (found.issues.length) throw new Error(`本机原生工具链未就绪：${found.issues.map(issue => issue.message).join("；")}`)
    const env: NodeJS.ProcessEnv = { ...process.env, ...await platform.nativeEnvironment(found.local), ...(platform.name === "win32" ? { VSLANG: "1033" } : {}) }
    // PATH 的大小写来自系统，不保留两份 Windows 环境变量
    if (platform.name === "win32") for (const key of Object.keys(env)) if (key !== "PATH" && key.toUpperCase() === "PATH") {
        env.PATH = env[key]
        delete env[key]
    }
    const cmake = found.local.cmake?.path
    const ninja = found.local.ninja?.path
    const ctest = cmake ? await locateTool(join(dirname(cmake), platform.name === "win32" ? "ctest.exe" : "ctest"), env) ?? await locateTool("ctest", env) : undefined
    if (!cmake || !ninja || !ctest) throw new Error("本机原生验收需要 CMake、CTest 和 Ninja")
    return { local: found.local, platform: platform.name, cmake, ninja, ctest, env }
}

export function nativeToolchain() { return discovery ??= discover() }

export function nativeExecutable(directory: string, name: string): string { return resolve(directory, `${name}${process.platform === "win32" ? ".exe" : ""}`) }

export function nativeTestDirectory(flavor: "Debug" | "Release" = "Debug"): string {
    const configuration = `${process.arch === "arm64" ? "a" : "x"}${flavor === "Debug" ? "d" : "r"}`
    return resolve(repoRoot, process.env.ARRANGE_NATIVE_TEST_BUILD_DIR ?? `build/test-${process.platform === "win32" ? "win" : "mac"}-${configuration}`)
}

export async function nativeCmake(args: readonly string[]): Promise<void> {
    const tools = await nativeToolchain()
    await nativeSessionRun(tools.cmake, args, tools.env)
}

export async function configureNativeBuild(source: string, build: string, flavor: "Debug" | "Release", definitions: readonly string[] = []): Promise<void> {
    const tools = await nativeToolchain()
    // clang++ 的调用名决定 C++ 链接行为，不能用其指向的 clang 替代；Windows 保留原有物理路径规则
    const compiler = (tools.platform === "darwin" ? resolve(tools.local.nativeCompiler!.path) : await realpath(tools.local.nativeCompiler!.path)).replaceAll("\\", "/")
    await claimNativeVerification(build)
    const args = ["-S", resolve(source), "-B", resolve(build), "-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${tools.ninja}`, `-DCMAKE_BUILD_TYPE=${flavor}`, `-DCMAKE_CXX_COMPILER=${compiler}`, `-DCMAKE_C_COMPILER=${tools.platform === "darwin" ? join(dirname(compiler), "clang") : compiler}`]
    if (tools.platform === "darwin") args.push(`-DCMAKE_OSX_ARCHITECTURES=${tools.local.native!.architecture === "arm64" ? "arm64" : "x86_64"}`)
    else args.push(`-DCMAKE_OBJECT_PATH_MAX=${windowsObjectPathMax}`)
    const requested: Record<string, string> = {}
    for (const key of ["JUCE_DIR", "ARRANGE_QUICKJS_NG_SOURCE_DIR", "FETCHCONTENT_SOURCE_DIR_JUCE", "FETCHCONTENT_SOURCE_DIR_QUICKJS_NG"]) if (process.env[key]) requested[key] = process.env[key]
    for (const definition of definitions) {
        const match = definition.match(/^-D([^=]+)=(.*)$/s)
        if (!match) throw new Error(`不支持的原生验收定义：${definition}`)
        requested[match[1]!] = match[2]!
    }
    const cached = await cachedNativeDefinitions(requested)
    args.push(...Object.entries(cached).map(([key, value]) => `-D${key}=${value}`))
    const complete = await new NativeBuildTree(currentNativeSession().signal).prepare(source, build, [args, tools.local, { SDKROOT: tools.env.SDKROOT, WindowsSdkDir: tools.env.WindowsSdkDir }], process.argv.includes("--clean"))
    const completeReferences = await new BuildReferences(resolve(build)).begin(cached, repoRoot)
    await nativeCmake(args)
    await completeReferences()
    await complete()
}

export async function configureSmokeBuild(build: string, flavor: "Debug" | "Release" = "Debug"): Promise<void> {
    await configureNativeBuild(repoRoot, build, flavor, ["-DARRANGE_BUILD_TESTS=ON"])
}

export async function nativeCtest(directory: string, flavor: "Debug" | "Release"): Promise<void> {
    const tools = await nativeToolchain()
    const evidence = resolve(repoRoot, ".arrange/verification", `${tools.platform}-${tools.local.native!.architecture}`)
    await mkdir(evidence, { recursive: true })
    // 运行序列包含窗口和全局输入；保持串行，避免本机系统资源互相污染
    await nativeSessionRun(tools.ctest, ["--test-dir", directory, "-C", flavor, "--output-on-failure", "--no-tests=error", "--output-junit", resolve(evidence, `native-${flavor.toLowerCase()}.xml`)], tools.env)
    console.log("[ArrangeNativeTest]", `${tools.platform}/${tools.local.native!.architecture} ${flavor} 本机 CTest 完成`)
}
