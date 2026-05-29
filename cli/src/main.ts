import {mkdirSync} from "node:fs"
import {resolve} from "node:path"
import {packageArtifacts} from "./artifacts.ts"
import type {Flavor, Product} from "./config.ts"
import {hasConfig, readProjectConfig} from "./config.ts"
import {CLI_COMPATIBILITY, CLI_VERSION} from "./constants.ts"
import {assertCompatible, fetchFrameworkMetadata, readInstalledFrameworkMetadata} from "./framework.ts"
import {adoptProject, createProject} from "./wizard.ts"
import {cmakeBuildArgs, cmakeConfigureArgs, ensureProjectFiles} from "./project.ts"
import {run} from "./process.ts"
import {runVite, spawnNativeStandalone} from "./vite.ts"
import {readArrangeRegistryFromNpmrc} from "./package-resolve.ts"
import {ensureToolchain, type ResolvedToolchain} from "./local.ts"

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
    if (!projectOnly && check) {
        await ensureToolchain(config, process.cwd(), {ui: scope === "all" || scope === "ui", native: scope === "all" || scope === "native"}, {interactive: false, write: false})
        console.log("toolchain check 通过。")
    }
    if (!projectOnly && !check) {
        const toolchain = await ensureToolchain(config, process.cwd(), {ui: scope === "all" || scope === "ui", native: scope === "all" || scope === "native"})
        if (scope === "all" || scope === "ui") await run(toolchain.packageManagerCommand!, ["install"], {cwd: resolve(process.cwd(), config.ui.path), toolchain, label: `${config.ui.packageManager} install`})
        if (scope === "all" || scope === "native") await configureNative(config, "debug", toolchain)
    }
}

async function dev(parsed: Parsed): Promise<void> {
    const config = await loadAndCheckProject()
    const flavor = flavorOf(parsed, "debug")
    const uiOnly = parsed.flags.has("ui-only")
    const nativeOnly = parsed.flags.has("native-only")
    if (uiOnly && nativeOnly) throw new Error("--ui-only 与 --native-only 互斥。")
    const toolchain = await ensureToolchain(config, process.cwd(), {ui: !nativeOnly, native: !uiOnly})
    if (nativeOnly) {
        await spawnNativeStandalone(config, flavor, toolchain)
        return
    }
    if (uiOnly) {
        await runVite(config, "dev", [], toolchain)
        return
    }
    await Promise.all([
        runVite(config, "dev", [], toolchain),
        spawnNativeStandalone(config, flavor, toolchain),
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
    const toolchain = await ensureToolchain(config, process.cwd(), {ui: !nativeOnly, native: !uiOnly})
    if (!nativeOnly) await runVite(config, "build", [], toolchain)
    if (!uiOnly) {
        await configureNative(config, flavor, toolchain)
        await buildNative(config, flavor, products, toolchain)
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

async function configureNative(config: ReturnType<typeof readProjectConfig>, flavor: Flavor, toolchain: ResolvedToolchain): Promise<void> {
    if (!toolchain.cmake) throw new Error("native configure 需要 CMake，但本机工具链未提供。")
    mkdirSync(resolve(process.cwd(), config.native.path, config.native.cmake.buildDir, flavor), {recursive: true})
    await run(toolchain.cmake.command, cmakeConfigureArgs(config, process.cwd(), flavor, toolchain.cmake), {toolchain, msvc: true, label: "cmake configure"})
}

async function buildNative(config: ReturnType<typeof readProjectConfig>, flavor: Flavor, products: Product[], toolchain: ResolvedToolchain): Promise<void> {
    if (!toolchain.cmake) throw new Error("native build 需要 CMake，但本机工具链未提供。")
    const targets = products.map((product) => `${config.project.name}_${product === "standalone" ? "Standalone" : "VST3"}`)
    for (const target of targets) await run(toolchain.cmake.command, [...cmakeBuildArgs(config, process.cwd(), flavor, toolchain.cmake), "--target", target], {toolchain, msvc: true, label: `cmake build ${target}`})
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
