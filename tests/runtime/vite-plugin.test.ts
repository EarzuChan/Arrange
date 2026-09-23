import test from "node:test"
import { compileScript, parse } from '../../packages/compiler/src/sfa/index.ts'
import assert from "node:assert/strict"
import { resolve } from "node:path"
import arrange from "../../packages/vite-plugin/src/plugin.ts"
import { MODULE_SNAPSHOT_PATH, createModuleSnapshot } from '../../packages/vite-plugin/src/module-snapshot.ts'
import { createServer } from 'vite'
import ts from 'typescript'

test("vite plugin config freezes Arrange dev server and app.js output defaults", () => {
    const plugin = arrange()
    const config = plugin.config()
    assert.deepEqual(config.server, { host: "127.0.0.1", port: 9178, strictPort: true })
    assert.equal(config.build.rollupOptions.input, "src/main.ts")
    assert.equal(config.build.rollupOptions.output.entryFileNames, "app.js")
    assert.equal(config.build.rollupOptions.output.chunkFileNames, "chunks/[name]-[hash].js")
})

test("vite plugin registers the live ESM snapshot endpoint", () => {
    const plugin = arrange()
    const registrations: Array<{ path: string; handler: unknown }> = []
    plugin.configureServer({
        middlewares: {
            use(path: string, handler: unknown) {
                registrations.push({ path, handler })
            },
        },
    })
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].path, MODULE_SNAPSHOT_PATH)
    assert.equal(typeof registrations[0].handler, "function")
})

test("vite plugin returns transformed ESM boundaries and native HMR without browser client", { timeout: 30000 }, async () => {
    const root = resolve("demo/ui-src")
    const server = await createServer({ root, configFile: false, plugins: [arrange()], server: { middlewareMode: true, hmr: false } })
    try {
        const snapshot = await createModuleSnapshot(server, 'src/main.ts')
        assert.equal(snapshot.entry, '/@arrange/entry')
        assert.ok(snapshot.modules.length > 20)
        assert.match(snapshot.modules.find(module => module.url === '/src/main.ts')!.source, /import /)
        const client = snapshot.modules.find(module => module.url === '/@vite/client')!.source
        assert.match(client, /createHotContext/)
        assert.doesNotMatch(client, /document\.|window\.|WebSocket|updateStyle/)
        assert.ok(snapshot.modules.some(module => module.url.split('?')[0] === '/src/App.sfa'))
    } finally { await server.close() }
})

test("vite plugin leaves ordinary ESM entry to Vite import analysis", async () => {
    const plugin = arrange()
    const transformed = await plugin.transform.call({
        warn() {
        }
    }, 'import { createApp } from "@arrange/framework";\n', "C:/demo/ui-src/src/main.ts")
    assert.equal(transformed, null)
})

test('live 动态 import 辅助名称不覆盖用户绑定', async () => {
    const source = `const __arrangeImport = 7\nconst __arrangeImport_ = 8\nexport const result = import('./dep').then(module => module.value + __arrangeImport + __arrangeImport_)`
    const server = { async transformRequest() { return { code: source } } } as unknown as Parameters<typeof createModuleSnapshot>[0]
    const snapshot = await createModuleSnapshot(server, 'entry.ts', ['/entry.ts'])
    const entry = snapshot.modules.find(module => module.url === '/entry.ts')!
    const output = ts.transpileModule(entry.source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { result?: Promise<number> } = {}
    new Function('require', 'exports', output)(() => ({
        importLiveModule: async (specifier: string, importer: string) => {
            assert.equal(specifier, './dep')
            assert.equal(importer, '/entry.ts')
            return { value: 15 }
        }
    }), exports)
    assert.equal(await exports.result, 30)
})

test("vite plugin lets Vite propagate updates to accept boundaries", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    const modules = [{ id: "App.sfa" }]
    const result = plugin.handleHotUpdate({
        file: "C:\\demo\\ui-src\\src\\App.sfa",
        modules,
        server: {
            ws: {
                send(event: { type?: string; event?: string; data?: { path?: string; timestamp?: number } }) {
                    sent.push(event)
                }
            }
        },
    })
    assert.equal(result, modules)
    assert.equal(sent.length, 0)
})

test("vite plugin preserves SFA modules as Arrangable accept boundaries", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    const result = plugin.handleHotUpdate({
        file: "C:/demo/ui-src/src/Counter.sfa",
        modules: [{ id: "Counter.sfa" }, { id: "Counter.sfa?type=script" }],
        server: {
            ws: {
                send(event: { type?: string; event?: string; data?: { path?: string; timestamp?: number } }) {
                    sent.push(event)
                }
            }
        },
    })

    assert.equal(result.length, 2)
    assert.equal(sent.length, 0)
})

test("vite plugin does not emit full reload for ordinary dependency updates", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    plugin.handleHotUpdate({
        file: "C:/demo/ui-src/node_modules/@arrange/framework/src/index.ts", // C盘何意味？
        modules: [],
        server: {
            ws: {
                send(event: { type?: string; event?: string; data?: { path?: string; timestamp?: number } }) {
                    sent.push(event)
                }
            }
        },
    })
    assert.deepEqual(sent, [])
})

test("vite plugin accepts Arrange arrangable template without warnings", async () => {
    const plugin = arrange()
    const warnings: string[] = []
    await plugin.transform.call({
        warn(warning: { message: string }) {
            warnings.push(warning.message)
        }
    }, '<template><Column><Text text="ok" /><Input placeholder="ok" /></Column></template>', 'App.sfa')
    assert.deepEqual(warnings, [])
})

test('SFA 仅接受 TS setup，模块导出及脚本属性在源码边界报错', () => {
    const compile = (source: string) => {
        const result = parse(source, { filename: '声明.sfa' })
        if (result.errors.length) throw result.errors[0]
        return compileScript(result.descriptor, {})
    }
    for (const source of ['<script>export default {}</script>', '<script setup>const count = 1</script>', '<script lang="ts">const count = 1</script>']) assert.throws(() => compile(source))
    assert.throws(() => compile('<script>const result = await Promise.resolve(1)</script>'), /初始化必须同步/)
    assert.throws(() => compile('<script>for await (const item of source) { console.log(item) }</script>'), /初始化必须同步/)
    assert.doesNotThrow(() => compile('<script>async function load() { return await Promise.resolve(1) }</script>'))

    const result = compile('<template><Text :text="title + count" /></template><script>defineProps<{ title: string }>()\nconst count = 1</script>')
    assert.equal(result.bindings?.title, 'props')
    assert.equal(result.bindings?.count, 'literal-const')
})


test('SFA 转译源码映射保留脚本位置与原始文件', async () => {
    const { SourceMapConsumer } = await import('source-map-js')
    const plugin = arrange()
    const source = '<template>\n    <Text :text="String(count)" />\n</template>\n<script>\nconst count: number = 17\n</script>'
    const result = await plugin.transform.call({ warn() { } }, source, 'Mapped.sfa')
    assert.ok(result && typeof result === 'object' && result.map)
    const consumer = new SourceMapConsumer(result.map as import('source-map-js').RawSourceMap)
    const lines: number[] = []
    consumer.eachMapping(mapping => { if (mapping.originalLine) lines.push(mapping.originalLine) })
    assert.ok(lines.includes(5), JSON.stringify(lines))
    assert.ok(lines.includes(2), JSON.stringify(lines))
    assert.ok(consumer.sourceContentFor('Mapped.sfa')?.includes('const count: number = 17'))
})
