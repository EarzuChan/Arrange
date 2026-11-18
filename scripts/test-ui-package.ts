import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'
import { UiBuildService } from '../cli/src/feature/building/UiBuildService.ts'
import { stateFor, testTask } from '../cli/tests/fixture.ts'
import { stageUiPackage, verifyUiPackage } from '../cli/src/feature/packing/UiPackage.ts'
import { ARRANGE_PACKAGE_VERSION } from '../packages/framework/src/version.ts'

const [command, compiler] = process.argv.slice(2)
assert.ok(compiler, '需要 arrange_ui_bytecode 编译器路径')
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
    const manifestPath = join(directory, 'arrange-ui.json')
    const { manifest } = await verifyUiPackage(directory, ARRANGE_PACKAGE_VERSION)
    // 强制静态 ESM 跨模块循环，避免 Vite 合并模块后绕过循环路径。
    const entryText = await readFile(join(directory, manifest.entry), 'utf8')
    const sources = new Map([
        [manifest.entry, `import { readCycle } from './cycle/a.js'; if (readCycle() !== 42) throw Error('cycle initialization');
${entryText}`],
        ['cycle/a.js', `import { b } from './b.js'; export const a = 19; export function readCycle() { /* arrange-source-only-probe */ return b() };`],
        ['cycle/b.js', `import { a } from './a.js'; export function b() { return import.meta.url === 'cycle/b.js' ? a + 23 : 0 };`],
    ])
    for (const [path, source] of sources) {
        await mkdir(join(directory, path, '..'), { recursive: true })
        await writeFile(join(directory, path), source)
        const record = { path, kind: 'module' as const, size: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex') }
        const index = manifest.entries.findIndex(row => row.path === path)
        if (index < 0) manifest.entries.push(record)
        else manifest.entries[index] = record
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const clean = await verifyUiPackage(directory, ARRANGE_PACKAGE_VERSION)
    assert.ok(clean.entries.some(item => item.kind === 'module' && item.path.startsWith('chunks/lazy-')))
    assert.equal(clean.entries.find(item => item.path === 'not-module.js')?.kind, 'asset')
    const zip = join(root, 'archived')
    await stageUiPackage(directory, zip, ARRANGE_PACKAGE_VERSION, 'zip', clean.digest)
    const bad = join(root, 'bad')
    await mkdir(bad)
    await writeFile(join(bad, 'arrange-ui.json'), JSON.stringify({ ...manifest, protocol: -1 }))
    execFileSync(command, [directory, zip, bad], { stdio: 'inherit' })
    const state = stateFor(root)
    state.project.framework.version = ARRANGE_PACKAGE_VERSION
    state.project.ui.directory = 'user-ui'
    state.project.ui.outputDirectory = 'dist'
    let fail = false
    const ui = new UiBuildService({ build: async (_state, _task, input) => cp(directory, input, { recursive: true }) }, {
        async compileUi(_state, _flavor, _task, input, output, list) {
            if (fail) throw new Error('模拟编译中断')
            return execFileSync(compiler, [input, output, list], { encoding: 'utf8' }).trim()
        },
    })
    const bytecode = await ui.build(state, testTask(), 'debug')
    const bc = await verifyUiPackage(bytecode, ARRANGE_PACKAGE_VERSION)
    assert.equal(bc.manifest.scriptFormat, 'bytecode')
    assert.ok(bc.entries.filter(row => row.kind === 'module').every(row => row.file?.endsWith('.qbc')))
    const cycle = await readFile(join(bytecode, 'cycle/a.js.qbc'))
    assert.equal(cycle.includes('arrange-source-only-probe'), false)
    await assert.rejects(readFile(join(bytecode, 'app.js')), { code: 'ENOENT' })
    assert.equal(await readFile(join(bytecode, 'not-module.js'), 'utf8'), 'throw Error("asset must not execute")')
    const bytecodeZip = join(root, 'bytecode-zip')
    await stageUiPackage(bytecode, bytecodeZip, ARRANGE_PACKAGE_VERSION, 'zip', bc.digest)
    execFileSync(command, [bytecode, bytecodeZip, bad], { stdio: 'inherit' })
    fail = true
    await assert.rejects(ui.build(state, testTask(), 'debug'), /模拟编译中断/)
    assert.equal((await verifyUiPackage(bytecode, ARRANGE_PACKAGE_VERSION)).digest, bc.digest)
    fail = false
    await ui.build(state, testTask(), 'debug')
    const bcPath = join(bytecode, 'arrange-ui.json')
    await writeFile(bcPath, JSON.stringify({ ...bc.manifest, engine: '0'.repeat(64) }))
    execFileSync(command, [bytecode, 'engine'], { stdio: 'inherit' })
    await writeFile(bcPath, JSON.stringify({ ...bc.manifest, format: 1 }))
    execFileSync(command, [bytecode, 'old-format'], { stdio: 'inherit' })
    await writeFile(bcPath, bc.contents)
    const lazy = bc.entries.find(row => row.path.startsWith('chunks/lazy-'))!
    const damagedChunk = await readFile(join(bytecode, lazy.file!))
    damagedChunk[0] ^= 1
    await writeFile(join(bytecode, lazy.file!), damagedChunk)
    await assert.rejects(verifyUiPackage(bytecode, ARRANGE_PACKAGE_VERSION), /摘要不符/)
    execFileSync(command, [bytecode, 'chunk', lazy.path], { stdio: 'inherit' })
    // 清单摘要正确时，故意损坏的 payload 应进入反序列化阶段再被拒绝。
    lazy.sha256 = createHash('sha256').update(damagedChunk).digest('hex')
    await writeFile(bcPath, JSON.stringify(bc.manifest))
    execFileSync(command, [bytecode, 'chunk', lazy.path], { stdio: 'inherit' })
    state.project.ui.scriptFormat = 'js'
    await ui.build(state, testTask(), 'debug')
    await assert.rejects(readFile(join(bytecode, 'app.js.qbc')), { code: 'ENOENT' })
    assert.equal((await verifyUiPackage(bytecode, ARRANGE_PACKAGE_VERSION)).manifest.scriptFormat, 'js')
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
