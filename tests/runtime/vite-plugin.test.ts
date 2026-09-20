import test from "node:test"
import { compileScript, parse } from '../../packages/arrange-vue-compiler-sfc/src/index.ts'
import assert from "node:assert/strict"
import { resolve } from "node:path"
import arrange from "../../packages/vite-plugin/src/plugin.ts"
import { DEV_BUNDLE_PATH } from "../../packages/vite-plugin/src/constraints.ts"
import { buildDevBundle } from "../../packages/vite-plugin/src/dev-bundle.ts"

test("vite plugin config freezes Arrange dev server and app.js output defaults", () => {
    const plugin = arrange()
    const config = plugin.config()
    assert.deepEqual(config.server, { host: "127.0.0.1", port: 9178, strictPort: true })
    assert.equal(config.build.rollupOptions.input, "src/main.ts")
    assert.equal(config.build.rollupOptions.output.entryFileNames, "app.js")
    assert.equal(config.build.rollupOptions.output.chunkFileNames, "chunks/[name]-[hash].js")
})

test("vite plugin registers an app.js dev bundle endpoint for native ArrangeEditor", () => {
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
    assert.equal(registrations[0].path, DEV_BUNDLE_PATH)
    assert.equal(typeof registrations[0].handler, "function")
})

test("vite plugin can build the native dev app.js bundle on demand", { timeout: 15000 }, async () => {
    const root = resolve("demo/ui-src")
    const code = await buildDevBundle({
        config: {
            root,
            mode: "development",
        },
    }, "src/main.ts")
    assert.match(code, /__ARRANGE_NATIVE__/)
    assert.match(code, /createApp/)
})

test("vite plugin injects Arrange HMR client into the configured entry", async () => {
    const plugin = arrange()
    const transformed = await plugin.transform.call({
        warn() {
        }
    }, 'import { createApp } from "@arrange/framework";\n', "C:/demo/ui-src/src/main.ts")
    assert.equal(typeof transformed, 'string')
    if (typeof transformed !== 'string') throw new Error('入口转换未返回源码')
    assert.match(transformed, /installArrangeHmrClient/)
    assert.match(transformed, /import\.meta\.hot/)
})

test("vite plugin emits Arrange reload events over Vite HMR channel", () => {
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
    assert.deepEqual(result, [])
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, "custom")
    assert.equal(sent[0].event, "arrange:reload")
    assert.equal(sent[0]?.data?.path, "C:/demo/ui-src/src/App.sfa")
    assert.equal(typeof sent[0]?.data?.timestamp, "number")
})

test("vite plugin suppresses arrangable-level HMR so native reload owns state cleanup", () => {
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

    assert.deepEqual(result, [])
    assert.equal(sent.length, 1)
    assert.equal(sent[0].event, "arrange:reload")
})

test("vite plugin does not emit Arrange reload for dependency updates", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    plugin.handleHotUpdate({
        file: "C:/demo/ui-src/node_modules/vue/index.ts",
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
    const result = await plugin.transform.call({ warn() {} }, source, 'Mapped.sfa')
    assert.ok(result && typeof result === 'object' && result.map)
    const consumer = new SourceMapConsumer(result.map as import('source-map-js').RawSourceMap)
    const lines: number[] = []
    consumer.eachMapping(mapping => { if (mapping.originalLine) lines.push(mapping.originalLine) })
    assert.ok(lines.includes(5), JSON.stringify(lines))
    assert.ok(lines.includes(2), JSON.stringify(lines))
    assert.ok(consumer.sourceContentFor('Mapped.sfa')?.includes('const count: number = 17'))
})
