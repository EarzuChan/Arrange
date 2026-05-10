import {existsSync} from "node:fs"
import {join} from "node:path"
import {repoRoot, run} from "../../scripts/common.ts"

const buildType = process.env.ARRANGE_DEMO_BUILD_TYPE === "Release" ? "Release" : "Debug"
const buildDir = buildType === "Release" ? "demo-ninja-release" : "demo-ninja-debug"
const smokeExe = join(repoRoot, "build", buildDir, "cpp_tests", "arrange_juce_runtime_smoke.exe")
const appEntry = join(repoRoot, "demo", "plugin-src", "ui", "app.js")

await run("node", ["scripts/build-demo.ts"], {
    env: {
        ...process.env,
        ARRANGE_DEMO_BUILD_TYPE: buildType,
    },
})

if (!existsSync(smokeExe)) {
    throw new Error(`Arrange runtime smoke executable was not built: ${smokeExe}`)
}

if (!existsSync(appEntry)) {
    throw new Error(`Arrange demo app entry was not built: ${appEntry}`)
}

await run(smokeExe, [appEntry])
