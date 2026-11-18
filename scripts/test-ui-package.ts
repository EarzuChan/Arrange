import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'
import { stageUiPackage, verifyUiPackage } from '../cli/src/feature/packing/UiPackage.ts'
import { ARRANGE_PACKAGE_VERSION } from '../packages/framework/src/version.ts'

const command = process.argv[2]
assert.ok(command, '需要 arrange_ui_package 原生测试程序路径')
const root = await mkdtemp(join(tmpdir(), 'arrange-m6-package-'))
try {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'public'))
    await writeFile(join(root, 'src/chunk.ts'), 'export default Number("20")\n')
    await writeFile(join(root, 'src/lazy.ts'), 'import base from "./chunk.ts"\nexport default base + 2\n')
    await writeFile(join(root, 'public/中文 %.json'), '{"value":42}')
    await writeFile(join(root, 'public/not-module.js'), 'throw Error("asset must not execute")')
    await writeFile(join(root, 'public/test.png'), await readFile(new URL('../demo/ui-src/public/arrange-logo.png', import.meta.url)))
    await writeFile(join(root, 'public/test.ttf'), await readFile(new URL('../tests/fixtures/fonts/ArrangeTestSans-Regular.ttf', import.meta.url)))
    await writeFile(join(root, 'src/main.ts'), `
        import value from './chunk.ts'
        const lazy = (await import('./lazy.ts')).default
        const n = (globalThis as any).__ARRANGE_NATIVE__
        n.installFrameDriver(() => {}, () => {}, () => {})
        const verify = async () => {
            const path = '/%E4%B8%AD%E6%96%87%20%25.json'
            const json = JSON.parse(await n.readAsset(path, true))
            const bytes = await n.readAsset('中文 %.json', false)
            if (!(bytes instanceof Uint8Array) || bytes[0] !== 123 || json.value !== value + lazy) throw Error('错误资产内容')
            const forbidden = ['.', 'not-module.js'].join('/')
            const failure = await import(forbidden).then(() => '', error => String(error))
            if (!failure.includes('找不到已登记模块')) throw Error(failure || '资产被当作可执行模块')
            const denied = await n.readAsset('/app.js', false).then(() => false, () => true)
            if (!denied) throw Error('读取到模块内容')
            n.createNode(1, 'Root')
        }
        void verify()
    `)
    const directory = join(root, 'built')
    await build({
        root, configFile: false, plugins: [arrange(), {
            name: 'split-test-modules',
            enforce: 'post',
            config: () => ({ build: { rollupOptions: { output: { codeSplitting: true } } } }),
        }], logLevel: 'silent', build: { outDir: directory }
    })
    const clean = await verifyUiPackage(directory, ARRANGE_PACKAGE_VERSION)
    assert.ok(clean.entries.some(item => item.kind === 'module' && item.path.startsWith('chunks/lazy-')))
    assert.equal(clean.entries.find(item => item.path === 'not-module.js')?.kind, 'asset')
    const zip = join(root, 'archived')
    await stageUiPackage(directory, zip, ARRANGE_PACKAGE_VERSION, 'zip', clean.digest)
    const bad = join(root, 'bad')
    await mkdir(bad)
    const manifest = JSON.parse(await readFile(join(directory, 'arrange-ui.json'), 'utf8'))
    await writeFile(join(bad, 'arrange-ui.json'), JSON.stringify({ ...manifest, protocol: -1 }))
    execFileSync(command, [directory, zip, bad], { stdio: 'inherit' })
    await writeFile(join(directory, '中文 %.json'), '{"value":24}')
    await assert.rejects(verifyUiPackage(directory, ARRANGE_PACKAGE_VERSION), /摘要不符/)
    execFileSync(command, [directory, 'digest'], { stdio: 'inherit' })
    const archive = await readFile(zip)
    const damaged = join(root, 'damaged')
    await writeFile(damaged, archive.subarray(0, -3))
    execFileSync(command, [damaged, 'ZIP'], { stdio: 'inherit' })
    await rm(join(bad, 'arrange-ui.json'))
    await writeFile(join(bad, 'app.js'), 'export {}')
    execFileSync(command, [bad, 'legacy'], { stdio: 'inherit' })
    await writeFile(join(root, 'public/app.js'), 'export {}')
    await assert.rejects(build({ root, configFile: false, plugins: [arrange()], logLevel: 'silent', build: { outDir: directory } }), /重名/)
} finally {
    await rm(root, { recursive: true, force: true })
}
