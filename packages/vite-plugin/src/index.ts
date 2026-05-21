import {createRequire} from "node:module"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import {transformWithEsbuild} from "vite"
import {compileScript, compileTemplate, parse} from "@arrange/vue-compiler-sfc"

const DOM_TAG_PATTERN = /<\s*(div|span|input|canvas|button|section|article|main|header|footer)(\s|>|\/)/
const CLASS_STYLE_PATTERN = /\s(class|style)\s*=/i
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

type ViteBuildChunk = {
    type: "chunk"
    fileName: string
    code: string
    isEntry?: boolean
}

type ViteBuildResult = {
    output?: Array<{type?: string; fileName?: string; code?: string; isEntry?: boolean}>
}

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

function hashId(filename: string, source: string): string {
    let hash = 0x811c9dc5
    const input = `${filename}\0${source}`
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

function supportsTs(lang: string | undefined): boolean {
    return typeof lang === "string" && /tsx?|mts|cts/i.test(lang)
}

function replaceExportRender(code: string): string {
    return code.replace(/^export\s+function\s+render/m, "function render")
}

function compileArrangeSfc(code: string, id: string): {code: string; warnings: string[]} {
    const filename = normalizePath(id)
    const descriptorResult = parse(code, {filename})
    if (descriptorResult.errors.length) {
        throw new Error(
            descriptorResult.errors
                .map((error) => error instanceof Error ? error.message : String(error))
                .join("\n"),
        )
    }

    const descriptor = descriptorResult.descriptor
    const warnings: string[] = []
    if (DOM_TAG_PATTERN.test(code)) warnings.push("Arrange does not render DOM/HTML tags; use Box/Row/Column/Text/Input/Canvas etc.")
    if (CLASS_STYLE_PATTERN.test(code)) warnings.push("Arrange ignores class/style attributes; use modifier instead.")
    if (descriptor.styles.length > 0) warnings.push("Arrange ignores SFC <style> blocks; use Modifier and theme tokens instead.")

    const shortId = hashId(filename, code)
    const compilerOptions = {runtimeModuleName: "@arrange/runtime"}

    if (descriptor.scriptSetup || descriptor.script) {
        const script = compileScript(descriptor, {
            id: shortId,
            genDefaultAs: "_sfc_main",
            inlineTemplate: Boolean(descriptor.template),
            templateOptions: {compilerOptions},
            isProd: true,
        })

        let output = script.content
        if (!descriptor.template) {
            output += "\nexport default _sfc_main"
        } else if (!script.content.includes("export default")) {
            output += "\nexport default _sfc_main"
        }
        return {
            code: output,
            warnings,
        }
    }

    if (!descriptor.template) {
        throw new Error(`Arrange SFC ${filename} contains no <script> or <template> block.`)
    }

    const template = compileTemplate({
        source: descriptor.template.content,
        filename,
        id: shortId,
        isProd: true,
        compilerOptions,
    })
    if (template.errors.length) {
        throw new Error(
            template.errors
                .map((error) => error instanceof Error ? error.message : String(error))
                .join("\n"),
        )
    }

    const codeBlock = replaceExportRender(template.code)
    const output = `const _sfc_main = {}\n${codeBlock}\n_sfc_main.render = render\nexport default _sfc_main`
    return {code: output, warnings}
}

async function importViteApiFromServerRoot(root: string): Promise<ViteModule> {
    const require = createRequire(resolve(root, "package.json"))
    const viteEntry = require.resolve("vite")
    return import(pathToFileURL(viteEntry).href) as Promise<ViteModule>
}

function outputOfBuildResult(result: ViteBuildResult | ViteBuildResult[]): ViteBuildChunk[] {
    const items = Array.isArray(result) ? result : [result]
    return items.flatMap((item) => item.output ?? []).filter((item): item is ViteBuildChunk => item.type === "chunk")
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
        define: {
            "process.env.NODE_ENV": JSON.stringify(config.mode === "production" ? "production" : "development"),
        },
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
    transform: (this: TransformThis, code: string, id: string) => string | Promise<string | null> | null
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
        transform(this: TransformThis, code: string, id: string): string | Promise<string | null> | null {
            if (isEntryModule(id, entry)) return injectHmrClient(code)
            if (!id.endsWith(".vue")) return null
            if (id.includes("?")) return null

            const {code: transformed, warnings} = compileArrangeSfc(code, id)
            for (const message of warnings) this.warn({id, message})

            const descriptor = parse(code, {filename: normalizePath(id)}).descriptor
            const needsEsbuild = supportsTs(descriptor.script?.lang) || supportsTs(descriptor.scriptSetup?.lang)
            if (!needsEsbuild) return transformed

            return transformWithEsbuild(transformed, id, {
                loader: "ts",
                target: "es2022",
                sourcemap: false,
            }).then((result) => result.code)
        },
    }
}

export {arrange}
export {DEV_BUNDLE_PATH}
