import {existsSync, readFileSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {parse as parseYamlSource, stringify as stringifyYamlValue} from "yaml"

export type PluginType = "effect" | "instrument"
export type Product = "standalone" | "vst3"
export type PackageManager = "pnpm" | "npm"
export type Flavor = "debug" | "release"

export type ArrangeConfig = {
    arrange: {version: string}
    project: {
        name: string
        version: string
        companyName: string
        companyCode: string
        pluginCode: string
        pluginType: PluginType
        products: Product[]
    }
    ui: {
        path: string
        packageManager: PackageManager
    }
    native: {
        path: string
        cmake: {
            buildDir: string
        }
    }
    artifacts: {
        path: string
        includeVersionDir: boolean
    }
}

export const CONFIG_FILE = "arrange.config.yaml"

const topLevelKeys = new Set(["arrange", "project", "ui", "native", "artifacts"])
const pluginTypes = new Set(["effect", "instrument"])
const products = new Set(["standalone", "vst3"])
const packageManagers = new Set(["pnpm", "npm"])
const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function configPath(cwd = process.cwd()): string {
    return resolve(cwd, CONFIG_FILE)
}

export function hasConfig(cwd = process.cwd()): boolean {
    return existsSync(configPath(cwd))
}

export function readProjectConfig(cwd = process.cwd()): ArrangeConfig {
    const path = configPath(cwd)
    if (!existsSync(path)) throw new Error(`No ${CONFIG_FILE} was found in the current directory. Run Arrange CLI from the Arrange project root.`)
    return normalizeConfig(parseYaml(readFileSync(path, "utf8")), path)
}

export function writeProjectConfig(config: ArrangeConfig, cwd = process.cwd()): void {
    writeFileSync(configPath(cwd), stringifyConfig(config))
}

export function defaultConfig(args: {
    frameworkVersion: string
    projectName: string
    projectVersion: string
    companyName: string
    companyCode: string
    pluginCode: string
    pluginType?: PluginType
    products?: Product[]
    packageManager?: PackageManager
    uiPath?: string
    nativePath?: string
    artifactsPath?: string
}): ArrangeConfig {
    return {
        arrange: {version: args.frameworkVersion},
        project: {
            name: args.projectName,
            version: args.projectVersion,
            companyName: args.companyName,
            companyCode: args.companyCode,
            pluginCode: args.pluginCode,
            pluginType: args.pluginType ?? "effect",
            products: args.products ?? ["standalone", "vst3"],
        },
        ui: {
            path: args.uiPath ?? "ui",
            packageManager: args.packageManager ?? "pnpm",
        },
        native: {
            path: args.nativePath ?? "native",
            cmake: {
                buildDir: "build",
            },
        },
        artifacts: {
            path: args.artifactsPath ?? "artifacts",
            includeVersionDir: true,
        },
    }
}

function normalizeConfig(raw: unknown, path: string): ArrangeConfig {
    const object = expectRecord(raw, path)
    for (const key of Object.keys(object)) if (!topLevelKeys.has(key)) throw new Error(`${path}: unknown top-level field ${key}`)

    const arrange = expectRecord(object.arrange, "arrange")
    const project = expectRecord(object.project, "project")
    const ui = optionalRecord(object.ui)
    const native = optionalRecord(object.native)
    const cmake = optionalRecord(native.cmake)
    const artifacts = optionalRecord(object.artifacts)
    assertKnownKeys(arrange, "arrange", ["version"])
    assertKnownKeys(project, "project", ["name", "version", "companyName", "companyCode", "pluginCode", "pluginType", "products"])
    assertKnownKeys(ui, "ui", ["path", "packageManager"])
    assertKnownKeys(native, "native", ["path", "cmake"])
    assertKnownKeys(cmake, "native.cmake", ["buildDir"])
    assertKnownKeys(artifacts, "artifacts", ["path", "includeVersionDir"])

    const arrangeVersion = expectString(arrange.version, "arrange.version")
    if (arrangeVersion === "latest") throw new Error("arrange.version must be a concrete version, not latest.")

    const projectVersion = expectString(project.version, "project.version")
    if (!semverPattern.test(projectVersion)) throw new Error(`project.version must be semver; received ${projectVersion}`)

    const pluginType = (project.pluginType === undefined ? "effect" : expectString(project.pluginType, "project.pluginType")) as PluginType
    if (!pluginTypes.has(pluginType)) throw new Error(`project.pluginType must be effect or instrument; received ${pluginType}`)

    const productList = project.products === undefined ? ["standalone", "vst3"] : expectStringArray(project.products, "project.products")
    if (productList.length === 0) throw new Error("project.products must not be empty.")
    for (const product of productList) if (!products.has(product)) throw new Error(`project.products only supports standalone or vst3; received ${product}`)

    const packageManager = (ui.packageManager === undefined ? "pnpm" : expectString(ui.packageManager, "ui.packageManager")) as PackageManager
    if (!packageManagers.has(packageManager)) throw new Error(`ui.packageManager only supports pnpm or npm; received ${packageManager}`)

    return {
        arrange: {version: arrangeVersion},
        project: {
            name: expectString(project.name, "project.name"),
            version: projectVersion,
            companyName: expectString(project.companyName, "project.companyName"),
            companyCode: expectString(project.companyCode, "project.companyCode"),
            pluginCode: expectString(project.pluginCode, "project.pluginCode"),
            pluginType,
            products: productList as Product[],
        },
        ui: {
            path: ui.path === undefined ? "ui" : expectString(ui.path, "ui.path"),
            packageManager,
        },
        native: {
            path: native.path === undefined ? "native" : expectString(native.path, "native.path"),
            cmake: {
                buildDir: cmake.buildDir === undefined ? "build" : expectString(cmake.buildDir, "native.cmake.buildDir"),
            },
        },
        artifacts: {
            path: artifacts.path === undefined ? "artifacts" : expectString(artifacts.path, "artifacts.path"),
            includeVersionDir: artifacts.includeVersionDir === undefined ? true : expectBoolean(artifacts.includeVersionDir, "artifacts.includeVersionDir"),
        },
    }
}

export function stringifyConfig(config: ArrangeConfig): string {
    return stringifyYaml(config)
}

export function parseYaml(source: string): unknown {
    try {
        return parseYamlSource(source)
    } catch (error) {
        throw new Error(`YAML syntax error: ${error instanceof Error ? error.message : String(error)}`)
    }
}

export function stringifyYaml(value: unknown): string {
    return stringifyYamlValue(value, {lineWidth: 0})
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
    return value as Record<string, unknown>
}

export function optionalRecord(value: unknown): Record<string, unknown> {
    if (value === undefined) return {}
    return expectRecord(value, "config item")
}

export function assertKnownKeys(value: Record<string, unknown>, label: string, allowed: readonly string[]): void {
    const allowedSet = new Set(allowed)
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) throw new Error(`${label}: unknown field ${key}`)
    }
}

export function expectString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`)
    return value
}

export function expectBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`)
    return value
}

export function expectStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings.`)
    return value as string[]
}
