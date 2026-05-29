import {spawn} from "node:child_process"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {dirname, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import {writeFileSync} from "node:fs"
import type {ArrangeConfig, Flavor} from "./config.ts"
import {DEFAULT_DEV_HOST, DEFAULT_DEV_PORT} from "./constants.ts"
import {frameworkExportPath} from "./package-resolve.ts"

const require = createRequire(import.meta.url)

type VitePackage = {bin: {vite: string} | string}

export async function runVite(config: ArrangeConfig, command: "dev" | "build", args: string[] = []): Promise<void> {
    const vitePackage = require("vite/package.json") as VitePackage
    const viteEntry = await import.meta.resolve("vite")
    const viteBinName = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin.vite
    const viteBin = resolve(dirname(fileURLToPath(viteEntry)), "..", "..", viteBinName)
    const tsxEntry = await import.meta.resolve("tsx")
    const nodeOptions = [process.env.NODE_OPTIONS, "--import", tsxEntry].filter(Boolean).join(" ")
    const uiRoot = resolve(process.cwd(), config.ui.path)
    const viteArgs = command === "dev" ? devArgs(uiRoot, args, true) : buildArgs(uiRoot, args, true)
    await spawnForward(process.execPath, [viteBin, ...viteArgs], {
        cwd: uiRoot,
        env: {...process.env, NODE_OPTIONS: nodeOptions},
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
    const arrangeViteEntry = resolveFramework
        ? pathToFileURL(frameworkExportPath(uiRoot, "./vite")).href
        : "@arrange/framework/vite"
    const configPath = resolve(tmpdir(), `arrange-cli-vite-config-${process.pid}-${Date.now()}.mjs`)
    writeFileSync(configPath, [
        `import arrange from ${JSON.stringify(arrangeViteEntry)}`,
        `export default { plugins: [arrange()] }`,
        "",
    ].join("\n"))
    return configPath
}

export async function spawnNativeStandalone(config: ArrangeConfig, flavor: Flavor): Promise<void> {
    const executable = await findStandaloneExecutable(config, flavor)
    if (!executable) {
        console.log("未找到 native Standalone 产物；请先运行 arrange build --native-only 或使用宿主加载插件。")
        return
    }
    await spawnForward(executable, [], {cwd: dirname(executable), env: process.env})
}

async function findStandaloneExecutable(config: ArrangeConfig, flavor: Flavor): Promise<string | null> {
    const {findNativeArtifact} = await import("./artifacts.ts")
    return findNativeArtifact(config, process.cwd(), flavor, "standalone")
}

function spawnForward(command: string, args: string[], options: {cwd: string; env: NodeJS.ProcessEnv}): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {cwd: options.cwd, env: options.env, stdio: "inherit", shell: false})
        let forwardingSignal = false
        function forwardSignal(signal: NodeJS.Signals): void {
            if (child.exitCode !== null || forwardingSignal) return
            forwardingSignal = true
            child.kill(signal)
            setTimeout(() => {
                if (child.exitCode === null) child.kill("SIGKILL")
            }, 5000).unref()
        }
        process.once("SIGINT", () => forwardSignal("SIGINT"))
        process.once("SIGTERM", () => forwardSignal("SIGTERM"))
        child.on("error", reject)
        child.on("exit", (code, signal) => {
            if (typeof code === "number" && code !== 0) reject(new Error(`${command} exited with ${code}`))
            else if (signal) reject(new Error(`${command} exited by signal ${signal}`))
            else resolvePromise()
        })
    })
}
