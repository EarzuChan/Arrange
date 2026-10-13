import { buildDemoUi } from "./demo-build.ts"
import { configureSmokeBuild, nativeCmake, nativeCtest, nativeTestDirectory } from "./native-toolchain.ts"
import { withNativeSession } from "./native-session.ts"

await withNativeSession(async () => {


    const flavor = process.env.ARRANGE_NATIVE_TEST_FLAVOR ?? "Debug"
    if (flavor !== "Debug" && flavor !== "Release") throw new Error("ARRANGE_NATIVE_TEST_FLAVOR 只接受 Debug 或 Release")
    const build = nativeTestDirectory(flavor)
    await buildDemoUi()
    await configureSmokeBuild(build, flavor)
    await nativeCmake(["--build", build, "--config", flavor, "--parallel", process.env.CMAKE_BUILD_PARALLEL_LEVEL ?? "4"])
    await nativeCtest(build, flavor)

}, [nativeTestDirectory(process.env.ARRANGE_NATIVE_TEST_FLAVOR === "Release" ? "Release" : "Debug")])
