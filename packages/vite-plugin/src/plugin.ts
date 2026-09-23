import { ARRANGE_DEFINES, PUBLIC_PLUGIN_NAME } from "./constraints.ts"
import { createModuleSnapshot, MODULE_SNAPSHOT_PATH } from './module-snapshot.ts'
import type { ViteDevServer } from 'vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArrangeTransformPlugin } from "./transform.ts"
import { invalidateSfaTypeDependency } from "./sfa.ts"
import type { ArrangeDevServer, ArrangeViteConfig, ArrangeVitePlugin, ArrangeVitePluginOptions, ConfigEnv, HotUpdateContext, HotUpdateModule } from "./types.ts"

export default function arrange(options: ArrangeVitePluginOptions = {}): ArrangeVitePlugin {
    const runtimeRoots = ['@arrange/framework/internal', '@arrange/reactivity', '@arrange/shared'].map(name => dirname(fileURLToPath(import.meta.resolve(name))).replaceAll('\\', '/') + '/')
    const entry = options.entry ?? "src/main.ts"
    let command: string | undefined = "serve"
    const transformPlugin = createArrangeTransformPlugin({
        name: PUBLIC_PLUGIN_NAME,
        hot: () => command === "serve",
    })
    return {
        ...transformPlugin,
        config(_config: unknown = {}, env: ConfigEnv = {}): ArrangeViteConfig {
            command = env.command
            const nodeEnv = env.mode === "production" || env.command === "build" ? "production" : "development"
            return {
                define: {
                    ...ARRANGE_DEFINES,
                    "process.env.NODE_ENV": JSON.stringify(nodeEnv),
                },
                server: { host: options.host ?? "127.0.0.1", port: options.port ?? 9178, strictPort: options.strictPort ?? true },
                build: {
                    target: "es2022",
                    rollupOptions: {
                        input: entry,
                        output: {
                            format: "es",
                            entryFileNames: "app.js",
                            codeSplitting: false,
                            chunkFileNames: "chunks/[name]-[hash].js",
                            assetFileNames: "assets/[name]-[hash][extname]",
                        },
                    },
                },
            }
        },
        configureServer(server: ArrangeDevServer): void {
            server.middlewares?.use(MODULE_SNAPSHOT_PATH, async (req, res) => {
                try {
                    const query = new URL((req as { url?: string }).url ?? '/', 'http://arrange').searchParams
                    const snapshot = await createModuleSnapshot(server as ViteDevServer, entry, query.getAll('url'))
                    res.statusCode = 200
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.setHeader('Cache-Control', 'no-store')
                    res.end(JSON.stringify(snapshot))
                } catch (error) {
                    res.statusCode = 500
                    res.end(error instanceof Error ? error.stack ?? error.message : String(error))
                }
            })
        },
        handleHotUpdate(ctx: HotUpdateContext): HotUpdateModule[] {
            invalidateSfaTypeDependency(ctx.file)
            // runtime 自身维护实例、响应式和原生绑定身份；更新其实现必须重建整个 JS 世界
            if (runtimeRoots.some(root => ctx.file.replaceAll('\\', '/').startsWith(root))) {
                ctx.server?.ws?.send?.({ type: 'full-reload', path: '*' })
                return []
            }
            return ctx.modules
        },
    }
}

export { arrange }
