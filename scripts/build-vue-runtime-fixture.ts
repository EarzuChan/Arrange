import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {build, type Plugin} from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({
    root,
    configFile: false,
    plugins: [arrange({entry: resolve(root, 'tests/fixtures/vue-runtime/main.ts')}) as unknown as Plugin],
    resolve: {alias: {'@arrange/framework': resolve(root, 'packages/framework/src/index.ts')}},
    build: {outDir: resolve(root, 'build/vue-runtime-fixture'), emptyOutDir: true},
})
