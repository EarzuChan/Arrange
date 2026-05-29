import {mkdirSync} from "node:fs"
import {resolve} from "node:path"
import {createInterface} from "node:readline/promises"
import {stdin as input, stdout as output} from "node:process"
import type {ArrangeConfig, PackageManager, PluginType, Product} from "./config.ts"
import {defaultConfig, writeProjectConfig} from "./config.ts"
import {CLI_COMPATIBILITY, DEFAULT_FRAMEWORK_VERSION} from "./constants.ts"
import {cmakeBuildDir, cmakeConfigureArgs, ensureProjectFiles} from "./project.ts"
import {run} from "./process.ts"
import {assertCompatible, fetchFrameworkCandidates, fetchFrameworkMetadata, normalizeRegistryUrl, type FrameworkVersionCandidate} from "./framework.ts"
import {ensureToolchain} from "./local.ts"

export type WizardOptions = {
    registry?: string
}

export async function createProject(options: WizardOptions = {}): Promise<void> {
    const registry = options.registry ? normalizeRegistryUrl(options.registry) : undefined
    const rl = createInterface({input, output})
    try {
        const projectName = await ask(rl, "项目名", "MyPlugin")
        const projectVersion = await ask(rl, "项目版本", "0.1.0")
        const frameworkVersion = await chooseFrameworkVersion(rl, registry)
        const companyName = await ask(rl, "公司名", "Earzu")
        const companyCode = await ask(rl, "公司代码", "Earz")
        const pluginCode = await ask(rl, "插件代码", "Arng")
        const pluginType = await askEnum<PluginType>(rl, "插件类型 effect/instrument", ["effect", "instrument"], "effect")
        const packageManager = await askEnum<PackageManager>(rl, "UI 包管理器 pnpm/npm", ["pnpm", "npm"], "pnpm")
        const products = await askProducts(rl)
        const config = defaultConfig({frameworkVersion, projectName, projectVersion, companyName, companyCode, pluginCode, pluginType, packageManager, products})
        printSummary(config)
        if (!await confirm(rl, "确认创建")) return
        writeProjectConfig(config)
        const changed = ensureProjectFiles(config, process.cwd(), {scope: "all", registry})
        console.log(`已创建 Arrange 工程：${changed.join(", ")}`)
        if (await confirm(rl, "现在执行 sync")) {
            rl.close()
            await runToolchainSync(config, registry)
        }
    } finally {
        rl.close()
    }
}

export async function adoptProject(options: WizardOptions = {}): Promise<void> {
    const registry = options.registry ? normalizeRegistryUrl(options.registry) : undefined
    const rl = createInterface({input, output})
    try {
        const nativePath = await ask(rl, "native path（留空则 native）", "native")
        const uiPath = await ask(rl, "ui path（留空则 ui）", "ui")
        const projectName = await ask(rl, "项目名", "MyPlugin")
        const projectVersion = await ask(rl, "项目版本", "0.1.0")
        const frameworkVersion = await chooseFrameworkVersion(rl, registry)
        const companyName = await ask(rl, "公司名", "Earzu")
        const companyCode = await ask(rl, "公司代码", "Earz")
        const pluginCode = await ask(rl, "插件代码", "Arng")
        const pluginType = await askEnum<PluginType>(rl, "插件类型 effect/instrument", ["effect", "instrument"], "effect")
        const packageManager = await askEnum<PackageManager>(rl, "UI 包管理器 pnpm/npm", ["pnpm", "npm"], "pnpm")
        const products = await askProducts(rl)
        const config = defaultConfig({frameworkVersion, projectName, projectVersion, companyName, companyCode, pluginCode, pluginType, packageManager, products, nativePath, uiPath})
        printSummary(config)
        if (!await confirm(rl, "确认收编")) return
        writeProjectConfig(config)
        const changed = ensureProjectFiles(config, process.cwd(), {scope: "all", registry})
        console.log(`已接入 Arrange 工程：${changed.join(", ")}`)
        if (await confirm(rl, "现在执行 sync")) {
            rl.close()
            await runToolchainSync(config, registry)
        }
    } finally {
        rl.close()
    }
}

async function runToolchainSync(config: ArrangeConfig, registry?: string): Promise<void> {
    const toolchain = await ensureToolchain(config, process.cwd(), {ui: true, native: true})
    if (!toolchain.cmake) throw new Error("sync native 需要 CMake，但本机工具链未提供。")
    const installArgs = registry ? ["install", "--registry", registry] : ["install"]
    await run(toolchain.packageManagerCommand!, installArgs, {cwd: resolve(process.cwd(), config.ui.path), toolchain, label: `${config.ui.packageManager} install`})
    mkdirSync(cmakeBuildDir(config, process.cwd(), "debug"), {recursive: true})
    await run(toolchain.cmake.command, cmakeConfigureArgs(config, process.cwd(), "debug", toolchain.cmake), {toolchain, msvc: true, label: "cmake configure"})
}

async function ask(rl: ReturnType<typeof createInterface>, label: string, defaultValue: string): Promise<string> {
    const answer = (await rl.question(`${label} (${defaultValue}): `)).trim()
    return answer || defaultValue
}

async function askEnum<T extends string>(rl: ReturnType<typeof createInterface>, label: string, allowed: readonly T[], defaultValue: T): Promise<T> {
    while (true) {
        const answer = await ask(rl, label, defaultValue)
        if ((allowed as readonly string[]).includes(answer)) return answer as T
        console.log(`只能选择：${allowed.join(", ")}`)
    }
}

async function askProducts(rl: ReturnType<typeof createInterface>): Promise<Product[]> {
    const answer = await ask(rl, "产品 standalone,vst3", "standalone,vst3")
    const products = answer.split(",").map((item) => item.trim()).filter(Boolean)
    if (products.every((item) => item === "standalone" || item === "vst3")) return products as Product[]
    console.log("产品输入无效，使用 standalone,vst3。")
    return ["standalone", "vst3"]
}

async function chooseFrameworkVersion(rl: ReturnType<typeof createInterface>, registry?: string): Promise<string> {
    let candidates: FrameworkVersionCandidate[] = []
    try {
        candidates = await fetchFrameworkCandidates(6, registry)
    } catch (error) {
        console.log(`无法读取 npm 版本列表：${error instanceof Error ? error.message : String(error)}`)
        return ask(rl, "Arrange framework 版本", DEFAULT_FRAMEWORK_VERSION)
    }
    while (true) {
        console.log(`当前 CLI 的兼容性是 ${CLI_COMPATIBILITY}`)
        console.log("请选择 Arrange 框架的版本：")
        candidates.forEach((candidate, index) => {
            const prefix = candidate.latest ? "最新版本  " : "          "
            const stability = candidate.stable ? "稳定版" : "预发行版"
            const incompatible = candidate.cliCompatibility === CLI_COMPATIBILITY ? "" : `  不兼容：${candidate.cliCompatibility}`
            console.log(`${index + 1}. ${prefix}${candidate.version}  ${stability}${incompatible}`)
        })
        console.log(`${candidates.length + 1}.           自定义版本`)
        const answer = (await rl.question("> ")).trim()
        const selectedIndex = Number(answer)
        if (Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= candidates.length) {
            const candidate = candidates[selectedIndex - 1]
            if (candidate.cliCompatibility !== CLI_COMPATIBILITY) {
                console.log(`该版本不兼容：${candidate.cliCompatibility}`)
                continue
            }
            return candidate.version
        }
        if (selectedIndex === candidates.length + 1 || answer.toLowerCase() === "custom") {
            const version = await ask(rl, "自定义版本", DEFAULT_FRAMEWORK_VERSION)
            try {
                const metadata = await fetchFrameworkMetadata(version, registry)
                assertCompatible(metadata)
                candidates.push({version: metadata.version, cliCompatibility: metadata.cliCompatibility, latest: false, stable: !metadata.version.includes("-")})
                return metadata.version
            } catch (error) {
                console.log(`自定义版本不可用：${error instanceof Error ? error.message : String(error)}`)
                continue
            }
        }
        console.log("请输入候选编号。")
    }
}

async function confirm(rl: ReturnType<typeof createInterface>, label: string): Promise<boolean> {
    const answer = (await rl.question(`${label}? y/N: `)).trim().toLowerCase()
    return answer === "y" || answer === "yes"
}

function printSummary(config: ReturnType<typeof defaultConfig>): void {
    console.log("\nArrange 工程信息：")
    console.log(`  project: ${config.project.name}@${config.project.version}`)
    console.log(`  framework: ${config.arrange.version}`)
    console.log(`  company: ${config.project.companyName} (${config.project.companyCode})`)
    console.log(`  plugin: ${config.project.pluginCode}, ${config.project.pluginType}`)
    console.log(`  products: ${config.project.products.join(", ")}`)
    console.log(`  ui: ${config.ui.path}, ${config.ui.packageManager}`)
    console.log(`  native: ${config.native.path}`)
    console.log("")
}
