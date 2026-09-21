import { defineConfig } from 'vite'
import arrange from '@arrange/framework/vite'

export default defineConfig({
    plugins: [arrange(), {
        name: 'arrange-package-runtime-boundary',
        generateBundle() {
            for (const id of this.getModuleIds()) {
                const path = id.replaceAll('\\', '/')
                if (/\/node_modules\/(?:@arrange\/(?:compiler|vite-plugin)|@babel\/[^/]+|vite|typescript)\//.test(path)) this.error(`应用运行时引入了构建工具：${id}`)
            }
        },
    }],
})
