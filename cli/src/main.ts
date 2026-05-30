import {mkdirSync} from "node:fs"
import {resolve} from "node:path"
import {packageArtifacts, findNativeArtifact} from "./artifacts.ts"
import type {ArrangeConfig, Flavor, Product} from "./config.ts"
import {hasConfig, readProjectConfig} from "./config.ts"
import {CLI_COMPATIBILITY, CLI_VERSION} from "./constants.ts"
import {renderError} from "./errors.ts"
import {assertCompatible, fetchFrameworkMetadata, readInstalledFrameworkMetadata} from "./framework.ts"
import {adoptProject, createProject} from "./wizard.ts"
import {cmakeBuildArgs, cmakeConfigureArgs, ensureProjectFiles} from "./project.ts"
import {run} from "./process.ts"
import {runVite, spawnNativeStandalone} from "./vite.ts"
import {readArrangeRegistryFromNpmrc} from "./package-resolve.ts"
import {ensureToolchain, type ResolvedToolchain} from "./local.ts"

export type CliResult = {exitCode: number}

type Parsed = {command: string; flags: Map<string, string[]>; positionals: string[]}

type ProjectContext = {
    root: string
    config: ArrangeConfig
}

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
                throw new Error(`Unknown command: ${parsed.command}\nRun arrange --help for usage.`)
        }
    } catch (error) {
        console.error(renderError(error))
        return {exitCode: 1}
    }
}

function help(): CliResult {
    console.log(`Arrange CLI ${CLI_VERSION} (cliCompatibility ${CLI_COMPATIBILITY})

Usage:
  arrange create [--registry <YOUR_BASE_URL>]
  arrange adopt [--registry <YOUR_BASE_URL>]
  arrange sync [--project-only|--toolchain-only] [--ui|--native] [--check]
  arrange dev [--ui-only|--native-only] [--flavor debug|release]
  arrange build [--flavor debug|release] [--ui-only|--native-only] [--no-package] [--product standalone|vst3] [--clean]
  arrange package [--flavor debug|release] [--product standalone|vst3] [--clean]
  arrange --version
`)
    return {exitCode: 0}
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
        if (takesValue && (!value || value.startsWith("--"))) throw new Error(`--${name} requires a value.`)
        const values = flags.get(name) ?? []
        values.push(value)
        flags.set(name, values)
    }
    return {command, flags, positionals}
}

function optionalFlag(parsed: Parsed, name: string): string | undefined {
    const values = parsed.flags.get(name) ?? []
    if (values.length > 1) throw new Error(`--${name} may only be provided once.`)
    return values.at(-1)
}

function assertFlags(parsed: Parsed, allowed: readonly string[]): void {
    if (parsed.positionals.length > 0) throw new Error(`${parsed.command} does not accept positional arguments: ${parsed.positionals.join(" ")}`)
    const allowedSet = new Set(allowed)
    for (const flag of parsed.flags.keys()) if (!allowedSet.has(flag)) throw new Error(`${parsed.command} does not support --${flag}. Run arrange --help for usage.`)
}

function scopeOf(parsed: Parsed): "all" | "ui" | "native" {
    const ui = parsed.flags.has("ui")
    const native = parsed.flags.has("native")
    if (ui && native) throw new Error("--ui and --native are mutually exclusive.")
    return ui ? "ui" : native ? "native" : "all"
}

function flavorOf(parsed: Parsed, defaultFlavor: Flavor): Flavor {
    const raw = parsed.flags.get("flavor")?.at(-1)
    if (!raw) return defaultFlavor
    if (raw !== "debug" && raw !== "release") throw new Error("--flavor must be debug or release.")
    return raw
}

function productsOf(parsed: Parsed, defaults: Product[]): Product[] {
    const raw = parsed.flags.get("product") ?? []
    if (raw.length === 0) return defaults
    const result: Product[] = []
    for (const item of raw) {
        if (item !== "standalone" && item !== "vst3") throw new Error("--product must be standalone or vst3.")
        result.push(item)
    }
    return result
}

// CMD IMPLs

async function sync(parsed: Parsed): Promise<void> {
    const {root, config} = await loadAndCheckProject()
    const projectOnly = parsed.flags.has("project-only")
    const toolchainOnly = parsed.flags.has("toolchain-only")
    const check = parsed.flags.has("check")
    if (projectOnly && toolchainOnly) throw new Error("--project-only and --toolchain-only are mutually exclusive.")
    const scope = scopeOf(parsed)
    if (!toolchainOnly) {
        const changed = ensureProjectFiles(config, root, {scope, check})
        reportProjectSync(changed, check)
    }
    if (!projectOnly && check) {
        await ensureToolchain(config, root, {ui: scope === "all" || scope === "ui", native: scope === "all" || scope === "native"}, {interactive: false, write: false})
        console.log("Toolchain check passed.")
    }
    if (!projectOnly && !check) {
        const toolchain = await ensureToolchain(config, root, {ui: scope === "all" || scope === "ui", native: scope === "all" || scope === "native"})
        if (scope === "all" || scope === "ui") await run(toolchain.packageManagerCommand!, ["install"], {cwd: resolve(root, config.ui.path), toolchain, label: `${config.ui.packageManager} install`})
        if (scope === "all" || scope === "native") await configureNative(config, root, "debug", toolchain)
    }
}

async function dev(parsed: Parsed): Promise<void> {
    const {root, config} = await loadAndCheckProject()
    const flavor = flavorOf(parsed, "debug")
    const uiOnly = parsed.flags.has("ui-only")
    const nativeOnly = parsed.flags.has("native-only")
    if (uiOnly && nativeOnly) throw new Error("--ui-only and --native-only are mutually exclusive.")
    const toolchain = await ensureToolchain(config, root, {ui: !nativeOnly, native: !uiOnly})
    if (!uiOnly) await ensureDevStandalone(config, root, flavor, toolchain)
    if (nativeOnly) {
        await spawnNativeStandalone(config, root, flavor, toolchain)
        return
    }
    if (uiOnly) {
        await runVite(config, root, "dev", [], toolchain)
        return
    }
    await Promise.all([
        runVite(config, root, "dev", [], toolchain),
        spawnNativeStandalone(config, root, flavor, toolchain),
    ])
}

async function build(parsed: Parsed): Promise<void> {
    const flavor = flavorOf(parsed, "release")
    const uiOnly = parsed.flags.has("ui-only")
    const nativeOnly = parsed.flags.has("native-only")
    if (uiOnly && nativeOnly) throw new Error("--ui-only and --native-only are mutually exclusive.")
    if (parsed.flags.has("clean") && (uiOnly || nativeOnly || parsed.flags.has("no-package"))) throw new Error("--clean is only valid for a full build that also packages artifacts.")
    const {root, config} = await loadAndCheckProject()
    const products = productsOf(parsed, config.project.products)
    const toolchain = await ensureToolchain(config, root, {ui: !nativeOnly, native: !uiOnly})
    if (!nativeOnly) await runVite(config, root, "build", [], toolchain)
    if (!uiOnly) {
        await configureNative(config, root, flavor, toolchain)
        await buildNative(config, root, flavor, products, toolchain)
    }
    if (!uiOnly && !nativeOnly && !parsed.flags.has("no-package")) {
        const written = packageArtifacts(config, root, {flavor, products, clean: parsed.flags.has("clean")})
        reportArtifacts(written)
    }
}

async function packageOnly(parsed: Parsed): Promise<void> {
    const {root, config} = await loadAndCheckProject()
    const flavor = flavorOf(parsed, "release")
    const products = productsOf(parsed, config.project.products)
    const written = packageArtifacts(config, root, {flavor, products, clean: parsed.flags.has("clean")})
    reportArtifacts(written)
}

async function loadAndCheckProject(): Promise<ProjectContext> {
    const root = process.cwd()
    if (!hasConfig(root)) throw new Error("No arrange.config.yaml was found in the current directory. Existing project commands must be run from the Arrange project root.")

    const config = readProjectConfig(root)
    const uiRoot = resolve(root, config.ui.path)
    const metadata = readInstalledFrameworkMetadata(root, config.ui.path) ?? await fetchFrameworkMetadata(config.arrange.version, readArrangeRegistryFromNpmrc(uiRoot))

    assertCompatible(metadata)
    return {root, config}
}

export async function ensureDevStandalone(config: ArrangeConfig, root: string, flavor: Flavor, toolchain: ResolvedToolchain): Promise<void> {
    if (findNativeArtifact(config, root, flavor, "standalone")) return
    console.log(`No ${flavor} Standalone artifact was found. Building it before starting dev.`)
    await configureNative(config, root, flavor, toolchain)
    await buildNative(config, root, flavor, ["standalone"], toolchain)
}

async function configureNative(config: ArrangeConfig, root: string, flavor: Flavor, toolchain: ResolvedToolchain): Promise<void> {
    if (!toolchain.cmake) throw new Error("Native configure requires CMake, but the local toolchain does not provide it.")
    mkdirSync(resolve(root, config.native.path, config.native.cmake.buildDir, flavor), {recursive: true})
    await run(toolchain.cmake.command, cmakeConfigureArgs(config, root, flavor, toolchain.cmake), {cwd: root, toolchain, msvc: true, label: "cmake configure"})
}

async function buildNative(config: ArrangeConfig, root: string, flavor: Flavor, products: Product[], toolchain: ResolvedToolchain): Promise<void> {
    if (!toolchain.cmake) throw new Error("Native build requires CMake, but the local toolchain does not provide it.")
    const targets = products.map((product) => `${config.project.name}_${product === "standalone" ? "Standalone" : "VST3"}`)
    for (const target of targets) await run(toolchain.cmake.command, [...cmakeBuildArgs(config, root, flavor, toolchain.cmake), "--target", target], {cwd: root, toolchain, msvc: true, label: `cmake build ${target}`})
}

function reportProjectSync(changed: string[], check: boolean): void {
    if (changed.length === 0) {
        console.log("Project sync: no project file updates needed.")
        return
    }

    console.log(check ? "Project sync check: updates are needed:" : "Project sync updated:")
    for (const item of changed) console.log(`  ${describeProjectChange(item)}`)
}

function describeProjectChange(item: string): string {
    const normalized = item.replace(/\\/g, "/")
    if (normalized.endsWith("CMakeLists.txt")) return `${item} (managed regions: fetchcontent, link-framework)`
    if (normalized.endsWith("package.json")) return `${item} (dependencies: @arrange/framework)`
    if (normalized.endsWith(".npmrc")) return `${item} (@arrange registry scope)`
    return item
}

function reportArtifacts(written: string[]): void {
    if (written.length === 0) {
        console.log("Artifacts: nothing copied.")
        return
    }

    console.log("Artifacts written:")
    for (const item of written) console.log(`  ${item}`)
}