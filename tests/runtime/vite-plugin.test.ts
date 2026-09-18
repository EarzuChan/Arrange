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
    assert.ok(transformed)
    assert.match(transformed, /installArrangeHmrClient/)
    assert.match(transformed, /import\.meta\.hot/)
})

test("vite plugin emits Arrange reload events over Vite HMR channel", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    const modules = [{ id: "App.vue" }]
    const result = plugin.handleHotUpdate({
        file: "C:\\demo\\ui-src\\src\\App.vue",
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
    assert.equal(sent[0]?.data?.path, "C:/demo/ui-src/src/App.vue")
    assert.equal(typeof sent[0]?.data?.timestamp, "number")
})

test("vite plugin suppresses component-level HMR so native reload owns state cleanup", () => {
    const plugin = arrange()
    const sent: Array<{ type?: string; event?: string; data?: { path?: string; timestamp?: number } }> = []
    const result = plugin.handleHotUpdate({
        file: "C:/demo/ui-src/src/Counter.vue",
        modules: [{ id: "Counter.vue" }, { id: "Counter.vue?type=script" }],
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

test("vite plugin accepts Arrange component template without warnings", () => {
    const plugin = arrange()
    const warnings: string[] = []
    plugin.transform.call({
        warn(warning: { message: string }) {
            warnings.push(warning.message)
        }
    }, '<template><Column><Text text="ok" /><Input placeholder="ok" /></Column></template>', 'App.vue')
    assert.deepEqual(warnings, [])
})

test('SFC 配置诊断覆盖普通 script 与 defineOptions，定位非法字段', () => {
    const compile = (source: string) => compileScript(parse(source, { filename: '组件配置.vue' }).descriptor, {})
    for (const options of ['data() { return {} }', 'computed: {}', 'methods: {}', "['created']() {}", 'mixins: []', 'extends: {}', 'template: "旧模板"']) {
        for (const source of [
            `<script>export default { ${options} }</script>`,
            `<script>import { defineComponent } from '@arrange/framework'; export default defineComponent({ ${options} })</script>`,
            `<script setup>defineOptions({ ${options} })</script>`,
        ]) {
            assert.throws(() => compile(source), error => error instanceof Error && error.message.includes('组件配置.vue') && error.message.includes(options))
        }
    }

    const result = compile('<script>export default { props: { title: String }, setup() { return { count: 1 } } }</script><template><Text :text="title + count" /></template>')
    assert.equal(result.bindings?.title, 'props')
    assert.equal(result.bindings?.count, 'setup-maybe-ref')
    const macro = compile('<script setup>defineOptions({ name: "正式组件", inheritAttrs: false })</script><template><Text text="有效" /></template>')
    assert.match(macro.content, /inheritAttrs: false/)
})
