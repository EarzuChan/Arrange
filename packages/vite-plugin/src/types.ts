export type ArrangeVitePluginOptions = {
    entry?: string
    devBundlePath?: string
    host?: string
    port?: number
    strictPort?: boolean
}

export type MiddlewareResponse = {
    statusCode: number
    setHeader: (name: string, value: string) => void
    end: (body?: string) => void
}

export type MiddlewareHandler = (req: unknown, res: MiddlewareResponse) => void | Promise<void>

export type ArrangeDevServer = {
    config?: {
        root: string
        mode: string
        configFile?: string
        arrangeViteApiRoot?: string
    }
    middlewares?: {use: (path: string, handler: MiddlewareHandler) => void}
}

export type HotUpdateModule = {
    id?: string
    file?: string
}

export type ArrangeReloadEvent = {
    type: "custom"
    event: "arrange:reload"
    data: {path: string; timestamp: number}
}

export type HotUpdateContext = {
    file: string
    modules: HotUpdateModule[]
    server?: {ws?: {send?: (event: ArrangeReloadEvent) => void}}
}

export type TransformWarning = {id: string; message: string}

export type TransformThis = {warn: (warning: TransformWarning) => void}

export type ConfigEnv = {command?: string; mode?: string}

export type ArrangeViteConfig = {
    define: Record<string, string>
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

export type ArrangeTransformPluginOptions = {
    name: string
    entry: string
    injectEntryHmrClient: () => boolean
}

export type ArrangeTransformPlugin = {
    name: string
    enforce: "pre"
    load: (id: string) => string | null
    transform: (this: TransformThis, code: string, id: string) => string | Promise<string | null> | null
}

export type ArrangeVitePlugin = ArrangeTransformPlugin & {
    config: (config?: unknown, env?: ConfigEnv) => ArrangeViteConfig
    configureServer: (server: ArrangeDevServer) => void
    handleHotUpdate: (ctx: HotUpdateContext) => HotUpdateModule[]
}
