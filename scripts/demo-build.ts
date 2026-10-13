import { existsSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot, run } from "./common.ts"
import { configureNativeBuild, nativeCmake } from "./native-toolchain.ts"
import { withNativeSession } from "./native-session.ts"

const demoUiRoot = resolve(repoRoot, "demo/ui-src")
const demoUiDistDir = resolve(repoRoot, "build/demo-ui-dist")
async function runPnpm(args: readonly string[]): Promise<void> {
    if (process.platform === "win32") {
        await run("cmd.exe", ["/d", "/c", "pnpm.cmd", ...args])
        return
    }
    await run("pnpm", args)
}

function normalizeBuildType(buildType: string | undefined): "Debug" | "Release" {
    return buildType === "Release" ? "Release" : "Debug"
}

function buildDirFor(buildType: "Debug" | "Release"): string {
    return `build/demo-${process.platform}-${process.arch}-${buildType.toLowerCase()}`
}

function cleanBuildDir(buildDir: string): void {
    const absolute = resolve(repoRoot, buildDir)
    if (!absolute.startsWith(repoRoot)) {
        throw new Error(`refuse to clean outside repo root: ${absolute}`)
    }
    if (existsSync(absolute)) {
        rmSync(absolute, { recursive: true, force: true })
    }
}

export async function buildDemoUi(): Promise<void> {
    await runPnpm(["--dir", demoUiRoot, "build"])
}

export async function buildDemoNative(buildType: string | undefined): Promise<void> {
    const buildDir = buildDirFor(normalizeBuildType(buildType))
    await withNativeSession(async () => {
        const normalizedBuildType = normalizeBuildType(buildType)
        cleanBuildDir(buildDir)
        await configureNativeBuild(resolve(repoRoot, "demo/plugin-src"), buildDir, normalizedBuildType, [`-DARRANGE_DEMO_ARRANGE_SOURCE_DIR=${repoRoot}`, `-DARRANGE_DEMO_UI_DIST_DIR=${demoUiDistDir}`])
        await nativeCmake(["--build", buildDir])
    }, [buildDir])
}

export async function buildDemo(buildType: string | undefined): Promise<void> {
    await buildDemoUi()
    await buildDemoNative(buildType)
}
