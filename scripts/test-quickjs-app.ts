import {cmakeExe, configureSmokeBuild, runInVsDev} from "./common.ts"

const buildDir = "build\\quickjs-app-smoke-ninja"
const smokeExe = `${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe`

await configureSmokeBuild(buildDir)
await runInVsDev(`"${cmakeExe()}" --build ${buildDir} --target arrange_quickjs_app_smoke`)
await runInVsDev(`${smokeExe} demo\\plugin-src\\ui\\app.js --expect-event-slot-count 6 --invoke-first-click-slot-repeated-transaction 1 --invoke-first-vertical-scroll-slot 17 --invoke-first-input-submit-slot QuickJSSmoke "Submitted: QuickJSSmoke"`)
await runInVsDev(`${smokeExe} demo\\plugin-src\\ui\\app.js --expect-current-transaction-event-slot-updates 6`)
