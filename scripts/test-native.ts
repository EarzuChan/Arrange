import {cmakeExe, configureSmokeBuild, runInVsDev} from "./common.ts"

const buildDir = "build\\native-smoke-ninja"

await configureSmokeBuild(buildDir)
await runInVsDev(`"${cmakeExe()}" --build ${buildDir} --target arrange_core_smoke`)
await runInVsDev(`${buildDir}\\cpp_tests\\arrange_core_smoke.exe`)
