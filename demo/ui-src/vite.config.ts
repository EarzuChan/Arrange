import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import arrange from '@arrange/framework/vite'

// 产品版本以工程共享配置为准，框架版本取实际安装的包
function projectVersion(): string {
    const config = readFileSync(new URL('../arrange.project.yaml', import.meta.url), 'utf8')
    const version = /^project:[^\S\n]*\n(?:[ \t]+.*\n)*?[ \t]+version:[ \t]*([^\s#]+)/m.exec(config.replace(/\r\n/g, '\n'))?.[1]
    if (!version) throw new Error('arrange.project.yaml 缺少 project.version')
    return version
}

function frameworkVersion(): string {
    const manifest = JSON.parse(readFileSync(new URL('./node_modules/@arrange/framework/package.json', import.meta.url), 'utf8')) as { version?: string }
    if (!manifest.version) throw new Error('@arrange/framework 的 package.json 缺少 version')
    return manifest.version
}

export default defineConfig({
    plugins: [arrange()],
    define: { __ARRANGE_DEMO_BUILD__: JSON.stringify({ version: projectVersion(), framework: frameworkVersion() }) },
    build: { outDir: "dist" },
})
