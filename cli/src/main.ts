import {mkdirSync} from "node:fs"
import {resolve} from "node:path"
import {packageArtifacts} from "./artifacts.ts"
import type {Flavor, Product} from "./config.ts"
import {hasConfig, readProjectConfig} from "./config.ts"
import {CLI_COMPATIBILITY, CLI_VERSION} from "./constants.ts"
import {assertCompatible, fetchFrameworkMetadata, readInstalledFrameworkMetadata} from "./framework.ts"
import {adoptProject, createProject} from "./wizard.ts"
import {cmakeBuildArgs, cmakeConfigureArgs, ensureProjectFiles} from "./project.ts"
import {cmakeExe, commandName, run} from "./process.ts"
import {runVite, spawnNativeStandalone} from "./vite.ts"
import {readArrangeRegistryFromNpmrc} from "./package-resolve.ts"

export type CliResult = {exitCode: number}

type Parsed = {command: string; flags: Map<string, string[]>; positionals: string[]}

export async function main(argv = process.argv.slice(2)): Promise<CliResult> {
    try {
        const parsed = parse(argv)
        if (parsed.command === "--help" || parsed.command === "-h" || parsed.command === "help") return help()
        if (parsed.command === "--version" || parsed.command === "-v") {
            console.log(CLI_VERSION)
            return {exitCode: 0}
        }
        switch (parsed.command || "help") {
            case "create":
                assertFlags(parsed, ["registry"])
                await createProject({registry: optionalFlag(parsed, "registry")})
                return {exitCode: 0}
            case "adopt":
                assertFlags(parsed, ["registry"])
                await adoptProject({registry: optionalFlag(parsed, "registry")})
                return {exitCode: 0}
            case "sync":
                assertFlags(parsed, ["project-only", "toolchain-only", "ui", "native", "check"])
                await sync(parsed)
                return {exitCode: 0}
            case "dev":
                assertFlags(parsed, ["ui-only", "native-only", "flavor"])
                await dev(parsed)
                return {exitCode: 0}
            case "build":
                assertFlags(parsed, ["flavor", "ui-only", "native-only", "no-package", "product", "clean"])
                await build(parsed)
                return {exitCode: 0}
            case "package":
                assertFlags(parsed, ["flavor", "product", "clean"])
                await packageOnly(parsed)
                return {exitCode: 0}
            default:
                throw new Error(`未知命令：${parsed.command}\n运行 arrange --help 查看用法。`)
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        return {exitCode: 1}
    }
}

function help(): CliResult {
    console.log(`Arrange CLI ${CLI_VERSION} (cliCompatibility ${CLI_COMPATIBILITY})

Usage:
  arrange create [--registry http://localhost:4873]
  arrange adopt [--registry http://localhost:4873]
  arrange sync [--project-only|--toolchain-only] [--ui|--native] [--check]
  arrange dev [--ui-only|--native-only] [--flavor debug|release]
  arrange build [--flavor debug|release] [--ui-only|--native-only] [--no-package] [--product standalone|vst3] [--clean]
  arrange package [--flavor debug|release] [--product standalone|vst3] [--clean]
  arrange --version
`)
    return {exitCode: 0}
}

function optionalFlag(parsed: Parsed, name: string): string | undefined {
    const values = parsed.flags.get(name) ?? []
    if (values.length > 1) throw new Error(`--${name} 只能出现一次。`)
    return values.at(-1)
}

function assertFlags(parsed: Parsed, allowed: readonly string[]): void {
    if (parsed.positionals.length > 0) throw new Error(`${parsed.command} 不接收位置参数：${parsed.positionals.join(" ")}`)
    const allowedSet = new Set(allowed)
    for (const flag of parsed.flags.keys()) {
        if (!allowedSet.has(flag)) throw new Error(`${parsed.command} 不支持参数 --${flag}。运行 arrange --help 查看用法。`)
    }
}

async function sync(parsed: Parsed): Promise<void> {
    const config = await loadAndCheckProject()
    const projectOnly = parsed.flags.has("project-only")
    const toolchainOnly = parsed.flags.has("toolchain-only")
    const check = parsed.flags.has("check")
    if (projectOnly && toolchainOnly) throw new Error("--project-only 与 --toolchain-only 互斥。")
    const scope = scopeOf(parsed)
    if (!toolchainOnly) {
        const changed = ensureProjectFiles(config, process.cwd(), {scope, check})
        if (changed.length) console.log(`${check ? "需要更新" : "已更新"}: ${changed.join(", ")}`)
        else console.log("project sync 无需更新。")
    }
    if (!projectOnly && !check) {
        if (scope === "all" || scope === "ui") await run(commandName(config.ui.packageManager), ["install"], {cwd: resolve(process.cwd(), config.ui.path)})
        if (scope === "all" || scope === "native") await configureNative(config, "debug")
    }
}

async function dev(parsed: Parsed): Promise<void> {
    const config = await loadAndCheckProject()
    const flavor = flavorOf(parsed, "debug")
    const uiOnly = parsed.flags.has("ui-only")
    const nativeOnly = parsed.flags.has("native-only")
    if (uiOnly && nativeOnly) throw new Error("--ui-only 与 --native-only 互斥。")
    if (nativeOnly) {
        await spawnNativeStandalone(config, flavor)
        return
    }
    if (uiOnly) {
        await runVite(config, "dev")
        return
    }
    await Promise.all([
        runVite(config, "dev"),
        spawnNativeStandalone(config, flavor),
    ])
}

async function build(parsed: Parsed): Promise<void> {
    const flavor = flavorOf(parsed, "release")
    const uiOnly = parsed.flags.has("ui-only")
    const nativeOnly = parsed.flags.has("native-only")
    if (uiOnly && nativeOnly) throw new Error("--ui-only 与 --native-only 互斥。")
    if (parsed.flags.has("clean") && (uiOnly || nativeOnly || parsed.flags.has("no-package"))) {
        throw new Error("--clean 只在完整 build 并整理 artifacts 时可用。")
    }
    const config = await loadAndCheckProject()
    const products = productsOf(parsed, config.project.products)
    if (!nativeOnly) await runVite(config, "build")
    if (!uiOnly) {
        await configureNative(config, flavor)
        await buildNative(config, flavor, products)
    }
    if (!uiOnly && !nativeOnly && !parsed.flags.has("no-package")) {
        const written = packageArtifacts(config, process.cwd(), {flavor, products, clean: parsed.flags.has("clean")})
        console.log(`已整理 artifacts: ${written.join(", ")}`)
    }
}

async function packageOnly(parsed: Parsed): Promise<void> {
    const config = await loadAndCheckProject()
    const flavor = flavorOf(parsed, "release")
    const products = productsOf(parsed, config.project.products)
    const written = packageArtifacts(config, process.cwd(), {flavor, products, clean: parsed.flags.has("clean")})
    console.log(`已整理 artifacts: ${written.join(", ")}`)
}

async function loadAndCheckProject() {
    if (!hasConfig()) throw new Error("当前目录没有 arrange.config.yaml。既有工程命令必须在 Arrange 工程根执行。")
    const config = readProjectConfig()
    const uiRoot = resolve(process.cwd(), config.ui.path)
    const metadata = readInstalledFrameworkMetadata(process.cwd(), config.ui.path)
        ?? await fetchFrameworkMetadata(config.arrange.version, readArrangeRegistryFromNpmrc(uiRoot))
    assertCompatible(metadata)
    return config
}

async function configureNative(config: ReturnType<typeof readProjectConfig>, flavor: Flavor): Promise<void> {
    mkdirSync(resolve(process.cwd(), config.native.path, config.native.cmake.buildDir, flavor), {recursive: true})
    await run(cmakeExe(), cmakeConfigureArgs(config, process.cwd(), flavor))
}

async function buildNative(config: ReturnType<typeof readProjectConfig>, flavor: Flavor, products: Product[]): Promise<void> {
    const targets = products.map((product) => `${config.project.name}_${product === "standalone" ? "Standalone" : "VST3"}`)
    for (const target of targets) await run(cmakeExe(), [...cmakeBuildArgs(config, process.cwd(), flavor), "--target", target])
}

function scopeOf(parsed: Parsed): "all" | "ui" | "native" {
    const ui = parsed.flags.has("ui")
    const native = parsed.flags.has("native")
    if (ui && native) throw new Error("--ui 与 --native 互斥。")
    return ui ? "ui" : native ? "native" : "all"
}

function flavorOf(parsed: Parsed, defaultFlavor: Flavor): Flavor {
    const raw = parsed.flags.get("flavor")?.at(-1)
    if (!raw) return defaultFlavor
    if (raw !== "debug" && raw !== "release") throw new Error("--flavor 只能是 debug 或 release。")
    return raw
}

function productsOf(parsed: Parsed, defaults: Product[]): Product[] {
    const raw = parsed.flags.get("product") ?? []
    if (raw.length === 0) return defaults
    const result: Product[] = []
    for (const item of raw) {
        if (item !== "standalone" && item !== "vst3") throw new Error("--product 只能是 standalone 或 vst3。")
        result.push(item)
    }
    return result
}

export function parse(argv: string[]): Parsed {
    const [command = "help", ...rest] = argv
    const flags = new Map<string, string[]>()
    const positionals: string[] = []
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index]
        if (!arg.startsWith("--")) {
            positionals.push(arg)
            continue
        }
        const name = arg.slice(2)
        const takesValue = name === "flavor" || name === "product" || name === "registry"
        const value = takesValue ? rest[++index] : "true"
        if (takesValue && (!value || value.startsWith("--"))) throw new Error(`--${name} 需要参数。`)
        const values = flags.get(name) ?? []
        values.push(value)
        flags.set(name, values)
    }
    return {command, flags, positionals}
}
