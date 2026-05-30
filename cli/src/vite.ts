import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {dirname, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import {writeFileSync} from "node:fs"
import type {ArrangeConfig, Flavor} from "./config.ts"
import {DEFAULT_DEV_HOST, DEFAULT_DEV_PORT} from "./constants.ts"
import {frameworkExportPath} from "./package-resolve.ts"
import type {ResolvedToolchain} from "./local.ts"
import {runForward} from "./process.ts"

const require = createRequire(import.meta.url)
const CLI_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

type VitePackage = {bin: {vite: string} | string}

export async function runVite(config: ArrangeConfig, projectRoot: string, command: "dev" | "build", args: string[] = [], toolchain?: ResolvedToolchain): Promise<void> {
    const vitePackage = require("vite/package.json") as VitePackage
    const viteEntry = await import.meta.resolve("vite")
    const viteBinName = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin.vite
    const viteBin = resolve(dirname(fileURLToPath(viteEntry)), "..", "..", viteBinName)
    const tsxEntry = await import.meta.resolve("tsx")
    const nodeOptions = [process.env.NODE_OPTIONS, "--import", tsxEntry].filter(Boolean).join(" ")
    const uiRoot = resolve(projectRoot, config.ui.path)
    const viteArgs = command === "dev" ? devArgs(uiRoot, args, true) : buildArgs(uiRoot, args, true)
    await runForward(process.execPath, [viteBin, ...viteArgs], {
        cwd: uiRoot,
        env: {...process.env, NODE_OPTIONS: nodeOptions},
        toolchain,
        label: command === "dev" ? "vite dev" : "vite build",
    })
}

export function normalizeViteArgs(command: "dev" | "build", extra: string[] = []): string[] {
    return command === "dev" ? devArgs(process.cwd(), extra, false) : buildArgs(process.cwd(), extra, false)
}

function devArgs(uiRoot: string, extra: string[], resolveFramework = true): string[] {
    return ["--host", DEFAULT_DEV_HOST, "--port", String(DEFAULT_DEV_PORT), "--strictPort", "--config", arrangeConfigFile(uiRoot, resolveFramework), ...extra]
}

function buildArgs(uiRoot: string, extra: string[], resolveFramework = true): string[] {
    return ["build", "--config", arrangeConfigFile(uiRoot, resolveFramework), ...extra]
}

function arrangeConfigFile(uiRoot: string, resolveFramework: boolean): string {
    const arrangeViteEntry = resolveFramework ? pathToFileURL(frameworkExportPath(uiRoot, "./vite")).href : "@arrange/framework/vite"
    const configPath = resolve(tmpdir(), `arrange-cli-vite-config-${process.pid}-${Date.now()}.mjs`)
    writeFileSync(configPath, [
        `import arrange from ${JSON.stringify(arrangeViteEntry)}`,
        `export default { arrangeViteApiRoot: ${JSON.stringify(CLI_PACKAGE_ROOT)}, plugins: [arrange()] }`,
        "",
    ].join("\n"))
    return configPath
}

export async function spawnNativeStandalone(config: ArrangeConfig, projectRoot: string, flavor: Flavor, toolchain?: ResolvedToolchain): Promise<void> {
    const executable = await findStandaloneExecutable(config, projectRoot, flavor)
    if (!executable) throw new Error(`No ${flavor} Standalone artifact was found. Run arrange build --native-only --flavor ${flavor} --product standalone.`)
    await runForward(executable, [], {cwd: dirname(executable), env: process.env, toolchain, msvc: true, label: "native Standalone"})
}

async function findStandaloneExecutable(config: ArrangeConfig, projectRoot: string, flavor: Flavor): Promise<string | null> {
    const {findNativeArtifact} = await import("./artifacts.ts")
    return findNativeArtifact(config, projectRoot, flavor, "standalone")
}
