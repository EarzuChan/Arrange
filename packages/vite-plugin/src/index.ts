import {createRequire} from "node:module"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"

const DOM_TAG_PATTERN = /<\s*(div|span|input|canvas|button|section|article|main|header|footer)(\s|>|\/)/
const CLASS_STYLE_PATTERN = /\s(class|style)\s*=/i
const SFC_STYLE_PATTERN = /<\s*style(\s|>)/i
const HMR_CLIENT_MARKER = "__ARRANGE_HMR_CLIENT__"
const HOT_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx"])
const DEV_BUNDLE_PATH = "/@arrange/app.js"

export type ArrangeVitePluginOptions = {
    entry?: string
    devBundlePath?: string
    host?: string
    port?: number
    strictPort?: boolean
}

type ViteModule = {
    build: (config: Record<string, unknown>) => Promise<ViteBuildResult>
    loadConfigFromFile: (env: {command: "build"; mode: string}, configFile: string) => Promise<{config?: Record<string, unknown>} | null>
    mergeConfig: (base: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>
}

type ViteOutputItem = {
    type?: string
    fileName?: string
    isEntry?: boolean
    code?: string
    output?: ViteOutputItem[]
}

type ViteBuildResult = ViteOutputItem | {output?: ViteOutputItem[]} | Array<{output?: ViteOutputItem[]}>
type MiddlewareHandler = (req: unknown, res: {statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void}) => void | Promise<void>
type ArrangeDevServer = {
    config?: {
        root: string
        mode: string
        configFile?: string
        arrangeViteApiRoot?: string
    }
    middlewares?: {use: (path: string, handler: MiddlewareHandler) => void}
}
type HotUpdateModule = {
    id?: string
    file?: string
}
type HotUpdateContext = {
    file: string
    modules: HotUpdateModule[]
    server?: {ws?: {send?: (event: ArrangeReloadEvent) => void}}
}
type ArrangeReloadEvent = {
    type: "custom"
    event: "arrange:reload"
    data: {path: string; timestamp: number}
}
type TransformWarning = {id: string; message: string}
type TransformThis = {warn: (warning: TransformWarning) => void}
type ArrangeViteConfig = {
    server: {host: string; port: number; strictPort: boolean}
    build: {
        target: string
        rollupOptions: {
            input: string
            output: {
                format: string
                entryFileNames: string
                chunkFileNames: string
                assetFileNames: string
            }
        }
    }
}

function normalizePath(id: unknown): string {
    return String(id ?? "").split("?")[0].replace(/\\/g, "/")
}

function extensionOf(id: unknown): string {
    const normalized = normalizePath(id)
    const dot = normalized.lastIndexOf(".")
    return dot < 0 ? "" : normalized.slice(dot)
}

function isEntryModule(id: unknown, entry: string): boolean {
    const normalized = normalizePath(id)
    const normalizedEntry = normalizePath(entry)
    return normalized === normalizedEntry || normalized.endsWith(`/${normalizedEntry}`)
}

function isHotSourceFile(id: unknown): boolean {
    const normalized = normalizePath(id)
    if (normalized.includes("/node_modules/")) return false
    return HOT_EXTENSIONS.has(extensionOf(normalized))
}

function injectHmrClient(code: string): string {
    if (code.includes(HMR_CLIENT_MARKER)) return code
    return `${code}
import { installArrangeHmrClient as ${HMR_CLIENT_MARKER} } from "@arrange/runtime"
if (import.meta.hot) ${HMR_CLIENT_MARKER}(import.meta.hot)
`
}

async function importViteApiFromServerRoot(root: string): Promise<ViteModule> {
    const require = createRequire(resolve(root, "package.json"))
    const viteEntry = require.resolve("vite")
    return import(pathToFileURL(viteEntry).href) as Promise<ViteModule>
}

function outputOfBuildResult(result: ViteBuildResult): ViteOutputItem[] {
    if (Array.isArray(result)) return result.flatMap((item) => item.output ?? [])
    if ("output" in result && Array.isArray(result.output)) return result.output
    return []
}

export async function buildDevBundle(server: ArrangeDevServer, entry: string): Promise<string> {
    if (!server.config) throw new Error("Arrange dev bundle requires Vite server config.")
    const config = server.config
    const viteApiRoot = config.arrangeViteApiRoot ?? config.root
    const {build, loadConfigFromFile, mergeConfig} = await importViteApiFromServerRoot(viteApiRoot)
    const loaded = config.configFile
        ? await loadConfigFromFile({command: "build", mode: config.mode}, config.configFile)
        : null
    const baseConfig = loaded?.config ?? {}
    const buildConfig = mergeConfig(baseConfig, {
        configFile: false,
        root: config.root,
        mode: config.mode,
        logLevel: "silent",
        build: {
            write: false,
            target: "es2022",
            rollupOptions: {
                input: resolve(config.root, entry),
                output: {
                    format: "es",
                    entryFileNames: "app.js",
                    assetFileNames: "assets/[name]-[hash][extname]",
                    codeSplitting: false,
                },
            },
        },
    })

    const result = await build(buildConfig)
    const output = outputOfBuildResult(result)
    const chunk = output.find((item) => item.type === "chunk" && item.fileName === "app.js")
        ?? output.find((item) => item.type === "chunk" && item.isEntry)
    if (!chunk?.code) throw new Error("Arrange dev bundle did not produce app.js.")
    return chunk.code
}

export type ArrangeVitePlugin = {
    name: string
    enforce: "pre"
    config: () => ArrangeViteConfig
    configureServer: (server: ArrangeDevServer) => void
    handleHotUpdate: (ctx: HotUpdateContext) => HotUpdateModule[]
    transform: (this: TransformThis, code: string, id: string) => string | null
}

export default function arrange(options: ArrangeVitePluginOptions = {}): ArrangeVitePlugin {
    const entry = options.entry ?? "src/main.ts"
    const devBundlePath = options.devBundlePath ?? DEV_BUNDLE_PATH
    return {
        name: "arrange-vite-plugin",
        enforce: "pre",
        config() {
            return {
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
        transform(this: TransformThis, code: string, id: string): string | null {
            if (isEntryModule(id, entry)) return injectHmrClient(code)
            if (!id.endsWith(".vue")) return null
            if (id.includes("?")) return null
            if (id.endsWith(".vue") && !code.includes("<template")) return null
            const warnings: string[] = []
            if (DOM_TAG_PATTERN.test(code)) warnings.push("Arrange does not render DOM/HTML tags; use Box/Row/Column/Text/Input/Canvas etc.")
            if (CLASS_STYLE_PATTERN.test(code)) warnings.push("Arrange ignores class/style attributes; use modifier instead.")
            if (SFC_STYLE_PATTERN.test(code)) warnings.push("Arrange ignores SFC <style>; use Modifier and theme tokens instead.")
            for (const message of warnings) this.warn({id, message})
            return null
        },
    }
}

export {arrange}
export {DEV_BUNDLE_PATH}
