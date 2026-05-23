import {ARRANGE_VUE_DEFINES, DEV_BUNDLE_PATH, PUBLIC_PLUGIN_NAME} from "./constraints.ts"
import {buildDevBundle} from "./dev-bundle.ts"
import {createArrangeTransformPlugin} from "./transform.ts"
import {isHotSourceFile, normalizePath} from "./sfc.ts"
import type {
    ArrangeDevServer,
    ArrangeViteConfig,
    ArrangeVitePlugin,
    ArrangeVitePluginOptions,
    ConfigEnv,
    HotUpdateContext,
    HotUpdateModule,
} from "./types.ts"

export default function arrange(options: ArrangeVitePluginOptions = {}): ArrangeVitePlugin {
    const entry = options.entry ?? "src/main.ts"
    const devBundlePath = options.devBundlePath ?? DEV_BUNDLE_PATH
    let command: string | undefined = "serve"
    const transformPlugin = createArrangeTransformPlugin({
        name: PUBLIC_PLUGIN_NAME,
        entry,
        injectEntryHmrClient: () => command === "serve",
    })
    return {
        ...transformPlugin,
        config(_config: unknown = {}, env: ConfigEnv = {}): ArrangeViteConfig {
            command = env.command
            const nodeEnv = env.mode === "production" || env.command === "build" ? "production" : "development"
            return {
                define: {
                    ...ARRANGE_VUE_DEFINES,
                    "process.env.NODE_ENV": JSON.stringify(nodeEnv),
                },
                server: {host: options.host ?? "127.0.0.1", port: options.port ?? 9178, strictPort: options.strictPort ?? true},
                build: {
                    target: "es2022",
                    rollupOptions: {
                        input: entry,
                        output: {
                            format: "es",
                            entryFileNames: "app.js",
                            chunkFileNames: "chunks/[name]-[hash].js",
                            assetFileNames: "assets/[name]-[hash][extname]",
                        },
                    },
                },
            }
        },
        configureServer(server: ArrangeDevServer): void {
            server.middlewares?.use(devBundlePath, async (_req, res) => {
                try {
                    const code = await buildDevBundle(server, entry)
                    res.statusCode = 200
                    res.setHeader("Content-Type", "application/javascript; charset=utf-8")
                    res.setHeader("Cache-Control", "no-store")
                    res.setHeader("X-Arrange-Dev-Bundle", "1")
                    res.end(code)
                } catch (error) {
                    res.statusCode = 500
                    res.setHeader("Content-Type", "text/plain; charset=utf-8")
                    res.end(error instanceof Error ? error.stack ?? error.message : String(error))
                }
            })
        },
        handleHotUpdate(ctx: HotUpdateContext): HotUpdateModule[] {
            if (!isHotSourceFile(ctx.file)) return ctx.modules
            ctx.server?.ws?.send?.({
                type: "custom",
                event: "arrange:reload",
                data: {
                    path: normalizePath(ctx.file),
                    timestamp: Date.now(),
                },
            })
            return []
        },
    }
}

export {arrange}
