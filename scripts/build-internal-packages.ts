import {createRequire} from "node:module"
import {existsSync, rmSync, mkdirSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import {repoRoot} from "./common.ts"

type ViteBuildOutputChunk = {
    type: "chunk"
    fileName: string
    code: string
}

type ViteBuildOutput = {
    output?: Array<{type?: string; fileName?: string; code?: string}>
}

type ViteModule = {
    build: (config: Record<string, unknown>) => Promise<ViteBuildOutput | ViteBuildOutput[]>
}

const packageRoot = resolve(repoRoot, "packages")
const viteRequire = createRequire(resolve(repoRoot, "package.json"))
const vite = await import(pathToFileURL(viteRequire.resolve("vite")).href) as unknown as ViteModule

const arrVueDefines = {
    __DEV__: `process.env.NODE_ENV !== "production"`,
    __TEST__: "false",
    __BROWSER__: "false",
    __SSR__: "false",
    __GLOBAL__: "false",
    __CJS__: "false",
    __ESM_BROWSER__: "false",
    __ESM_BUNDLER__: "true",
    __COMPAT__: "false",
    __FEATURE_OPTIONS_API__: "false",
    __FEATURE_SUSPENSE__: "true",
    __FEATURE_PROD_DEVTOOLS__: "false",
    __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    __VERSION__: JSON.stringify("3.5.34-arrange"),
}

const sharedAliases = {
    "@vue/shared": resolve(packageRoot, "arrange-vue-shared/src/index.ts"),
    "@vue/reactivity": resolve(packageRoot, "arrange-vue-reactivity/src/index.ts"),
    "@vue/runtime-core": resolve(packageRoot, "arrange-vue-runtime-core/src/index.ts"),
    "@vue/compiler-core": resolve(packageRoot, "arrange-vue-compiler-core/src/index.ts"),
    "@vue/compiler-dom": resolve(packageRoot, "arrange-vue-compiler-arrange/src/index.ts"),
}

type PackageBuildOptions = {
    name: string
    entry: string
    outDir: string
    aliases?: Record<string, string>
    external?: Array<string | RegExp>
    define?: Record<string, string>
}

function outputFiles(result: ViteBuildOutput | ViteBuildOutput[]): ViteBuildOutputChunk[] {
    const items = Array.isArray(result) ? result : [result]
    return items.flatMap((item) => item.output ?? []).filter((item): item is ViteBuildOutputChunk => item.type === "chunk")
}

function ensureDir(path: string): void {
    mkdirSync(path, {recursive: true})
}

async function buildPackage(options: PackageBuildOptions): Promise<void> {
    rmSync(options.outDir, {recursive: true, force: true})
    ensureDir(options.outDir)
    const result = await vite.build({
        configFile: false,
        logLevel: "silent",
        define: {
            ...arrVueDefines,
            "process.env.NODE_ENV": JSON.stringify("production"),
            ...options.define,
        },
        resolve: {
            alias: options.aliases ?? {},
        },
        build: {
            write: false,
            target: "es2022",
            lib: {
                entry: options.entry,
                formats: ["es", "cjs"],
                fileName: "index",
            },
            rollupOptions: {
                external: options.external ?? [],
            },
        },
    })
    const chunks = outputFiles(result)
    for (const chunk of chunks) {
        const filePath = resolve(options.outDir, chunk.fileName)
        ensureDir(resolve(filePath, ".."))
        writeFileSync(filePath, chunk.code, "utf8")
    }
    console.log(`built ${options.name}`)
}

await buildPackage({
    name: "@arrange/vue-shared",
    entry: resolve(packageRoot, "arrange-vue-shared/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-shared/dist"),
    external: [],
})

await buildPackage({
    name: "@arrange/vue-reactivity",
    entry: resolve(packageRoot, "arrange-vue-reactivity/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-reactivity/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/vue-runtime-core",
    entry: resolve(packageRoot, "arrange-vue-runtime-core/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-runtime-core/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/vue-compiler-core",
    entry: resolve(packageRoot, "arrange-vue-compiler-core/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-compiler-core/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/vue-compiler-arrange",
    entry: resolve(packageRoot, "arrange-vue-compiler-arrange/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-compiler-arrange/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/vue-compiler-sfc",
    entry: resolve(packageRoot, "arrange-vue-compiler-sfc/src/index.ts"),
    outDir: resolve(packageRoot, "arrange-vue-compiler-sfc/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/runtime",
    entry: resolve(packageRoot, "runtime/src/index.ts"),
    outDir: resolve(packageRoot, "runtime/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//],
})

await buildPackage({
    name: "@arrange/vite-plugin",
    entry: resolve(packageRoot, "vite-plugin/src/index.ts"),
    outDir: resolve(packageRoot, "vite-plugin/dist"),
    aliases: {
        ...sharedAliases,
    },
    external: [/^@arrange\//, "vite"],
})
