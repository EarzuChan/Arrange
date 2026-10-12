import { resolve } from 'node:path'
import { buildDemoUi } from './demo-build.ts'
import { run } from './common.ts'
import { configureSmokeBuild, nativeCmake, nativeExecutable, nativeTestDirectory } from './native-toolchain.ts'

const buildDir = nativeTestDirectory()
const smokeExe = nativeExecutable(resolve(buildDir, 'cpp_tests'), 'arrange_quickjs_app_smoke')
const appBundle = resolve('build/demo-ui-dist/app.js')

await buildDemoUi()
await configureSmokeBuild(buildDir)
await nativeCmake(["--build", buildDir, "--target", "arrange_quickjs_app_smoke", "arrange_juce_runtime_smoke", "--parallel", "4"])

// 交互验证使用生产 ArrangeRuntime，QuickJS 边界测试不另造发布与回执循环
await run(smokeExe, [appBundle])
await run(nativeExecutable(resolve(buildDir, 'cpp_tests'), 'arrange_juce_runtime_smoke'), [appBundle])
await run(smokeExe, [appBundle, '--expect-strict-modifier-ok', '{ elements: [] }'])
for (const expression of ["{ elements: 'not-array' }", "{ elements: [{ type: 'unknownModifier', value: {} }] }"]) {
    await run(smokeExe, [appBundle, '--expect-strict-modifier-error', expression])
}
await run(smokeExe, [appBundle, '--expect-script-diagnostics'])
await run(smokeExe, [appBundle, '--expect-script-diagnostics-rejection'])
