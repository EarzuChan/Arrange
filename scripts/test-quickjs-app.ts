import { resolve } from 'node:path'
import { buildDemoUi } from './demo-build.ts'
import { cmakeExe, configureSmokeBuild, run, runInVsDev } from './common.ts'

const buildDir = process.env.ARRANGE_NATIVE_TEST_BUILD_DIR ?? 'build/quickjs-app-smoke-ninja'
const smokeExe = resolve(buildDir, 'cpp_tests/arrange_quickjs_app_smoke.exe')
const appBundle = resolve('build/demo-ui-dist/app.js')

await buildDemoUi()
await configureSmokeBuild(buildDir)
await runInVsDev(`"${cmakeExe()}" --build "${buildDir}" --target arrange_quickjs_app_smoke arrange_juce_runtime_smoke --parallel 6`)

// 交互验证使用生产 ArrangeRuntime，QuickJS 边界测试不另造发布与回执循环
await run(smokeExe, [appBundle])
await run(resolve(buildDir, 'cpp_tests/arrange_juce_runtime_smoke.exe'), [appBundle])
await run(smokeExe, [appBundle, '--expect-strict-modifier-ok', '{ elements: [] }'])
for (const expression of ["{ elements: 'not-array' }", "{ elements: [{ type: 'unknownModifier', value: {} }] }", "{ elements: [{ type: 'width', value: {} }] }"]) {
    await run(smokeExe, [appBundle, '--expect-strict-modifier-error', expression])
}
await run(smokeExe, [appBundle, '--expect-script-diagnostics'])
await run(smokeExe, [appBundle, '--expect-script-diagnostics-rejection'])
