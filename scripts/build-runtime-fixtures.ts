import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build, type Plugin } from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
for (const fixture of ['rearrange-runtime', 'viewport-runtime']) await build({
    root,
    configFile: false,
    plugins: [arrange({ entry: resolve(root, `tests/fixtures/${fixture}/main.ts`) }) as unknown as Plugin],
    build: { outDir: resolve(root, `build/${fixture}-fixture`), emptyOutDir: true },
})
