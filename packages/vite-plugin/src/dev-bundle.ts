import {createRequire} from "node:module"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import {ARRANGE_VUE_DEFINES, DEV_BUNDLE_PLUGIN_NAME} from "./constraints.ts"
import {createArrangeTransformPlugin} from "./transform.ts"
import type {ArrangeDevServer} from "./types.ts"

type ViteModule = {
    build: (config: Record<string, unknown>) => Promise<ViteBuildResult | ViteBuildResult[]>
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

function importViteApiFromServerRoot(root: string): Promise<ViteModule> {
    const require = createRequire(resolve(root, "package.json"))
    const viteEntry = require.resolve("vite")
    return import(/* @vite-ignore */ pathToFileURL(viteEntry).href) as Promise<ViteModule>
}

function outputOfBuildResult(result: ViteBuildResult | ViteBuildResult[]): ViteBuildChunk[] {
    const items = Array.isArray(result) ? result : [result]
    return items.flatMap((item) => item.output ?? []).filter((item): item is ViteBuildChunk => item.type === "chunk")
}

function createDevBundlePlugins(entry: string) {
    return [
        createArrangeTransformPlugin({
            name: DEV_BUNDLE_PLUGIN_NAME,
            entry,
            injectEntryHmrClient: () => true,
        }),
    ]
}

export async function buildDevBundle(server: ArrangeDevServer, entry: string): Promise<string> {
    if (!server.config) throw new Error("Arrange dev bundle requires Vite server config.")
    const config = server.config
    const viteApiRoot = config.arrangeViteApiRoot ?? config.root
    const {build} = await importViteApiFromServerRoot(viteApiRoot)
    const buildConfig = {
        configFile: false,
        root: config.root,
        mode: config.mode,
        logLevel: "silent",
        plugins: createDevBundlePlugins(entry),
        define: {
            ...ARRANGE_VUE_DEFINES,
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
                    paths(id: string) {
                        return id
                    },
                },
            },
        },
    }

    const result = await build(buildConfig)
    const output = outputOfBuildResult(result)
    const chunk = output.find((item) => item.type === "chunk" && item.fileName === "app.js")
        ?? output.find((item) => item.type === "chunk" && item.isEntry)
    if (!chunk?.code) throw new Error("Arrange dev bundle did not produce app.js.")
    return chunk.code
}
