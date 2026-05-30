import {mkdirSync} from "node:fs"
import {resolve} from "node:path"
import type {ArrangeConfig, PackageManager, PluginType, Product} from "./config.ts"
import {defaultConfig, writeProjectConfig} from "./config.ts"
import {CLI_COMPATIBILITY, DEFAULT_FRAMEWORK_VERSION} from "./constants.ts"
import {cmakeBuildDir, cmakeConfigureArgs, ensureProjectFiles} from "./project.ts"
import {run} from "./process.ts"
import {assertCompatible, candidateIncompatibility, fetchFrameworkCandidates, fetchFrameworkMetadata, normalizeRegistryUrl, type FrameworkVersionCandidate} from "./framework.ts"
import {ensureToolchain} from "./local.ts"
import {promptCheckbox, promptExplicitConfirm, promptRequiredText, promptSelect} from "./prompt.ts"

export type WizardOptions = {
    registry?: string
}

const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const codePattern = /^[A-Za-z0-9]{4}$/
const projectNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/

export async function createProject(options: WizardOptions = {}): Promise<void> {
    const registry = options.registry ? normalizeRegistryUrl(options.registry) : undefined
    const projectName = await promptProjectName()
    const projectVersion = await promptSemver("Project version")
    const frameworkVersion = await chooseFrameworkVersion(registry)
    const companyName = await promptRequiredText("Company name", {hint: "non-empty text, for example your company or author name"})
    const companyCode = await promptCode("Company code")
    const pluginCode = await promptCode("Plugin code")
    const pluginType = await promptSelect<PluginType>("Plugin type", [
        {name: "Effect", value: "effect", description: "Audio effect plugin."},
        {name: "Instrument", value: "instrument", description: "Synth or instrument plugin."},
    ])
    const packageManager = await promptSelect<PackageManager>("UI package manager", [
        {name: "pnpm", value: "pnpm"},
        {name: "npm", value: "npm"},
    ])
    const products = await promptProducts()
    const config = defaultConfig({frameworkVersion, projectName, projectVersion, companyName, companyCode, pluginCode, pluginType, packageManager, products})
    printSummary(config)
    if (!await promptExplicitConfirm("Create this Arrange project?")) return
    const location = await promptSelect<"subdir" | "current">("Where should the project be created?", [
        {name: `Create in ./${projectName}`, value: "subdir", description: "Recommended for a new project."},
        {name: "Create in the current directory", value: "current", description: "Use only when the current directory is already the project root."},
    ])
    const projectRoot = location === "subdir" ? resolve(process.cwd(), projectName) : process.cwd()
    mkdirSync(projectRoot, {recursive: true})
    writeProjectConfig(config, projectRoot)
    const changed = ensureProjectFiles(config, projectRoot, {scope: "all", registry})
    reportProjectChanges(changed, "Project scaffolded")
    if (projectRoot !== process.cwd()) console.log(`Project root: ${projectRoot}. Run future Arrange commands from that directory.`)
    if (await promptExplicitConfirm("Run sync now?")) await runToolchainSync(config, projectRoot, registry)
}

export async function adoptProject(options: WizardOptions = {}): Promise<void> {
    const registry = options.registry ? normalizeRegistryUrl(options.registry) : undefined
    const nativePath = await promptRequiredText("Native project path", {hint: "relative or absolute path; use native for the standard layout"})
    const uiPath = await promptRequiredText("UI project path", {hint: "relative or absolute path; use ui for the standard layout"})
    const projectName = await promptProjectName()
    const projectVersion = await promptSemver("Project version")
    const frameworkVersion = await chooseFrameworkVersion(registry)
    const companyName = await promptRequiredText("Company name", {hint: "non-empty text, for example your company or author name"})
    const companyCode = await promptCode("Company code")
    const pluginCode = await promptCode("Plugin code")
    const pluginType = await promptSelect<PluginType>("Plugin type", [
        {name: "Effect", value: "effect"},
        {name: "Instrument", value: "instrument"},
    ])
    const packageManager = await promptSelect<PackageManager>("UI package manager", [
        {name: "pnpm", value: "pnpm"},
        {name: "npm", value: "npm"},
    ])
    const products = await promptProducts()
    const config = defaultConfig({frameworkVersion, projectName, projectVersion, companyName, companyCode, pluginCode, pluginType, packageManager, products, nativePath, uiPath})
    printSummary(config)
    if (!await promptExplicitConfirm("Adopt this Arrange project?")) return
    writeProjectConfig(config)
    const changed = ensureProjectFiles(config, process.cwd(), {scope: "all", registry})
    reportProjectChanges(changed, "Project adopted")
    if (await promptExplicitConfirm("Run sync now?")) await runToolchainSync(config, process.cwd(), registry)
}

async function runToolchainSync(config: ArrangeConfig, projectRoot: string, registry?: string): Promise<void> {
    const toolchain = await ensureToolchain(config, projectRoot, {ui: true, native: true})
    if (!toolchain.cmake) throw new Error("Native sync requires CMake, but arrange.local.yaml does not provide it.")
    const installArgs = registry ? ["install", "--registry", registry] : ["install"]
    await run(toolchain.packageManagerCommand!, installArgs, {cwd: resolve(projectRoot, config.ui.path), toolchain, label: `${config.ui.packageManager} install`})
    mkdirSync(cmakeBuildDir(config, projectRoot, "debug"), {recursive: true})
    await run(toolchain.cmake.command, cmakeConfigureArgs(config, projectRoot, "debug", toolchain.cmake), {cwd: projectRoot, toolchain, msvc: true, label: "cmake configure"})
}

async function promptProjectName(): Promise<string> {
    return promptRequiredText("Project name", {
        hint: "CMake target name; letters, numbers, and underscore; must start with a letter",
        validate: (value) => projectNamePattern.test(value) ? true : "Use letters, numbers, and underscore; start with a letter.",
    })
}

async function promptSemver(label: string): Promise<string> {
    return promptRequiredText(label, {
        hint: "semver, for example 0.1.0",
        validate: (value) => semverPattern.test(value) ? true : "Enter a valid semver version, for example 0.1.0.",
    })
}

async function promptCode(label: string): Promise<string> {
    return promptRequiredText(label, {
        hint: "exactly four ASCII letters or digits, for example Arng",
        validate: (value) => codePattern.test(value) ? true : "Enter exactly four ASCII letters or digits.",
    })
}

async function promptProducts(): Promise<Product[]> {
    return promptCheckbox<Product>("Products", [
        {name: "Standalone", value: "standalone"},
        {name: "VST3", value: "vst3"},
    ])
}

async function chooseFrameworkVersion(registry?: string): Promise<string> {
    let candidates: FrameworkVersionCandidate[] = []
    try {
        candidates = await fetchFrameworkCandidates(5, registry)
    } catch (error) {
        console.log(`Cannot read framework versions from the registry: ${error instanceof Error ? error.message : String(error)}`)
        return promptSemver("Arrange framework version")
    }
    while (true) {
        console.log(`Current CLI compatibility: ${CLI_COMPATIBILITY}`)
        const custom = Symbol("custom")
        const selected = await promptSelect<FrameworkVersionCandidate | typeof custom>("Arrange framework version", [
            ...candidates.map((candidate) => {
                const incompatibility = candidateIncompatibility(candidate)
                const prefix = candidate.latest ? "Latest version  " : "                "
                const stability = candidate.stable ? "stable" : "prerelease"
                return {
                    name: `${prefix}${candidate.version}  ${stability}${incompatibility ? `  ${incompatibility}` : ""}`,
                    value: candidate,
                    disabled: incompatibility ?? false,
                }
            }),
            {name: "Custom version", value: custom},
        ])
        if (selected !== custom) return selected.version
        const version = await promptRequiredText("Custom Arrange framework version", {hint: "exact published version, for example 0.0.0-m.2.2"})
        try {
            const metadata = await fetchFrameworkMetadata(version, registry)
            assertCompatible(metadata)
            candidates = [...candidates, {version: metadata.version, cliCompatibility: metadata.cliCompatibility, latest: false, stable: !metadata.version.includes("-"), publishedAt: null}]
            return metadata.version
        } catch (error) {
            console.log(`Custom version is not usable: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
}

function printSummary(config: ArrangeConfig): void {
    console.log("\nArrange project summary:")
    console.log(`  project: ${config.project.name}@${config.project.version}`)
    console.log(`  framework: ${config.arrange.version}`)
    console.log(`  company: ${config.project.companyName} (${config.project.companyCode})`)
    console.log(`  plugin: ${config.project.pluginCode}, ${config.project.pluginType}`)
    console.log(`  products: ${config.project.products.join(", ")}`)
    console.log(`  ui: ${config.ui.path}, ${config.ui.packageManager}`)
    console.log(`  native: ${config.native.path}`)
    console.log("")
}

function reportProjectChanges(changed: string[], heading: string): void {
    if (changed.length === 0) {
        console.log(`${heading}: no project files changed.`)
        return
    }
    console.log(`${heading}:`)
    for (const item of changed) console.log(`  updated ${item}`)
}
