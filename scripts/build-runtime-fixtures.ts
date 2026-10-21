import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build, type Plugin } from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'
import { ARRANGE_MACRO_PATTERN } from '../packages/vite-plugin/src/constraints.ts'
import { prepareRuntimeFixtureWorkspace } from '../tests/helpers/ui-fixture.ts'

if (!process.argv[2]) throw new Error('必须指定测试夹具输出目录')
const output = resolve(process.argv[2])
const workspace = resolve(output, 'workspace')
await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
const gallery = resolve(workspace, 'demo/ui-src')
await prepareRuntimeFixtureWorkspace(workspace)
for (const fixture of ['gallery', 'rearrange-runtime', 'viewport-runtime', 'm3-layout', 'm3-lazy', 'm3-draw']) {
    const root = fixture === 'gallery' ? gallery : workspace
    await build({
        root,
        configFile: false,
        plugins: [arrange({ entry: fixture === 'gallery' ? 'src/main.ts' : resolve(workspace, `tests/fixtures/${fixture}/main.ts`) }) as unknown as Plugin],
        build: { outDir: resolve(output, fixture), emptyOutDir: true },
    })
    const source = await readFile(resolve(output, fixture, 'app.js'), 'utf8')
    if (ARRANGE_MACRO_PATTERN.test(source)) throw new Error(`测试 UI 产物残留未替换的编译宏：${fixture}`)
}
