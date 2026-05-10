import {existsSync, rmSync} from "node:fs"
import {cmakeExe, configureSmokeBuild, runInVsDev} from "./common.ts"

const buildDir = "build\\native-smoke-ninja"

if (process.env.ARRANGE_CLEAN_NATIVE_SMOKE === "1" && existsSync(buildDir)) {
    rmSync(buildDir, {recursive: true, force: true})
}

await runInVsDev(`node tests/fixtures/bridge/write-basic-fixture.ts build/fixtures/bridge/basic-tree.bridge.bin`)
await configureSmokeBuild(buildDir)
await runInVsDev(`"${cmakeExe()}" --build ${buildDir} --target arrange_core_smoke`)
await runInVsDev(`${buildDir}\\cpp_tests\\arrange_core_smoke.exe build\\fixtures\\bridge\\basic-tree.bridge.bin`)
