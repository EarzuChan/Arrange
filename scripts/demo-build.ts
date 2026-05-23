import {existsSync, rmSync} from "node:fs"
import {resolve} from "node:path"
import {cmakeExe, ninjaExe, repoRoot, run, runInVsDev} from "./common.ts"

const windowsKitBin = "C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64"
const demoUiRoot = resolve(repoRoot, "demo/ui-src")
const demoUiDistDir = resolve(repoRoot, "build/demo-ui-dist")
const viteCli = resolve(repoRoot, "packages/vite-plugin/src/cli.ts")

function normalizeBuildType(buildType: string | undefined): "Debug" | "Release" {
    return buildType === "Release" ? "Release" : "Debug"
}

function buildDirFor(buildType: "Debug" | "Release"): string {
    return buildType === "Release" ? "build\\demo-ninja-release" : "build\\demo-ninja-debug"
}

function cleanBuildDir(buildDir: string): void {
    const absolute = resolve(repoRoot, buildDir)
    if (!absolute.startsWith(repoRoot)) {
        throw new Error(`refuse to clean outside repo root: ${absolute}`)
    }
    if (existsSync(absolute)) {
        rmSync(absolute, {recursive: true, force: true})
    }
}

function toolchainArgs(): string {
    const mt = `${windowsKitBin}/mt.exe`
    const rc = `${windowsKitBin}/rc.exe`
    return [mt, rc].every((tool) => existsSync(tool))
        ? ` -DCMAKE_MT="${mt}" -DCMAKE_RC_COMPILER="${rc}"`
        : ""
}

export async function buildDemoUi(): Promise<void> {
    await run(process.execPath, [
        "--experimental-transform-types",
        viteCli,
        "build",
        "--outDir",
        "../../build/demo-ui-dist",
        "--emptyOutDir",
    ], {
        cwd: demoUiRoot,
    })
}

export async function buildDemoNative(buildType: string | undefined): Promise<void> {
    const normalizedBuildType = normalizeBuildType(buildType)
    const buildDir = buildDirFor(normalizedBuildType)
    const cmake = cmakeExe()
    const ninja = ninjaExe()
    const juceDirArg = process.env.JUCE_DIR
        ? ` -DJUCE_DIR="${process.env.JUCE_DIR}"`
        : ""
    const quickJsDirArg = process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR
        ? ` -DARRANGE_QUICKJS_NG_SOURCE_DIR="${process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR}"`
        : ""
    const demoUiDistArg = ` -DARRANGE_DEMO_UI_DIST_DIR="${demoUiDistDir}"`

    cleanBuildDir(buildDir)
    await runInVsDev(`"${cmake}" -S . -B ${buildDir} -G Ninja -DCMAKE_MAKE_PROGRAM="${ninja}" -DCMAKE_BUILD_TYPE=${normalizedBuildType} -DARRANGE_WITH_QUICKJS_NG=ON -DARRANGE_BUILD_DEMO=ON -DARRANGE_BUILD_TESTS=ON${toolchainArgs()}${juceDirArg}${quickJsDirArg}${demoUiDistArg}`)
    await runInVsDev(`"${cmake}" --build ${buildDir}`)
}

export async function buildDemo(buildType: string | undefined): Promise<void> {
    await buildDemoUi()
    await buildDemoNative(buildType)
}
