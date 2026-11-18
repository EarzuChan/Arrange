import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 每组重新启动真实窗口；使用系统 D2D1，运行时由夹具核对实际模块路径
const root = resolve(import.meta.dirname, '..')
const build = resolve(root, process.env.ARRANGE_NATIVE_TEST_BUILD_DIR ?? 'build/m4-native-xr')
const output = resolve(root, process.argv[2] ?? 'build/render-attribution-cache')
const repeat = Number(process.argv[3] ?? 1)
const selected = process.argv[4]
const cases = [
    { name: 'all', native: 1, svg: 1 },
    { name: 'no-native', native: 0, svg: 1 },
    { name: 'no-svg', native: 1, svg: 0 },
    { name: 'no-native-svg', native: 0, svg: 0 },
]
if (process.platform !== 'win32') throw new Error('真实窗口输入基准目前仅支持 Windows')
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('轮次应为 1 到 20')
if (selected && !cases.some(item => item.name === selected)) throw new Error('未知对照组')
const chosen = selected ? cases.filter(item => item.name === selected) : cases
// 交替顺序，减少固定顺序与温度、频率变化混在一起
const ordered = repeat % 2 === 0 ? [...chosen].reverse() : chosen
mkdirSync(output, { recursive: true })
for (const item of ordered) {
    const run = resolve(output, `round-${repeat}`, item.name)
    mkdirSync(run, { recursive: true })
    const args = ['--fixture', resolve(build, 'fixtures/gallery'), '--out', run, '--scenario', 'mixed', '--duration', '8', '--timeout', '60', '--wheel-delta', '360', '--wheel-interval', '40', '--toggle-interval', '450', '--expect-d2d', resolve(process.env.WINDIR ?? 'C:/Windows', 'System32/d2d1.dll')]
    const env = { ...process.env, ARRANGE_RENDER_METRICS: '1', ARRANGE_BITMAP_NATIVE: String(item.native), ARRANGE_SVG_MASK_CACHE: String(item.svg) }
    writeFileSync(resolve(run, 'invocation.json'), JSON.stringify({ repeat, ...item, args, started: new Date().toISOString() }, null, 2))
    console.log('[RenderAttribution]', `第 ${repeat} 轮 ${item.name}，即将操作真实窗口`)
    const child = spawnSync(resolve(build, 'cpp_tests/arrange_gui_bench.exe'), args, { cwd: root, env, stdio: 'inherit', timeout: 75000 })
    if (child.error) throw child.error
    if (child.status !== 0) throw new Error(`窗口测试失败：${item.name}，退出码 ${child.status}`)
}
