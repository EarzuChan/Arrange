import {existsSync, readFileSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"

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
            generator?: string
            configureArgs: string[]
            buildArgs: string[]
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
    if (!existsSync(path)) throw new Error(`当前目录没有 ${CONFIG_FILE}。请进入 Arrange 工程根，或运行 arrange create / arrange adopt。`)
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
                configureArgs: [],
                buildArgs: [],
            },
        },
        artifacts: {
            path: args.artifactsPath ?? "artifacts",
            includeVersionDir: true,
        },
    }
}

function normalizeConfig(raw: unknown, path: string): ArrangeConfig {
    const object = expectRecord(raw, `${path}`)
    for (const key of Object.keys(object)) {
        if (!topLevelKeys.has(key)) throw new Error(`${path}: 未知顶层字段 ${key}`)
    }
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
    assertKnownKeys(cmake, "native.cmake", ["buildDir", "generator", "configureArgs", "buildArgs"])
    assertKnownKeys(artifacts, "artifacts", ["path", "includeVersionDir"])

    const arrangeVersion = expectString(arrange.version, "arrange.version")
    if (arrangeVersion === "latest") throw new Error("arrange.version 不能是 latest，必须是具体版本号。")

    const projectVersion = expectString(project.version, "project.version")
    if (!semverPattern.test(projectVersion)) throw new Error(`project.version 必须是 semver， got ${projectVersion}`)

    const pluginType = (project.pluginType === undefined ? "effect" : expectString(project.pluginType, "project.pluginType")) as PluginType
    if (!pluginTypes.has(pluginType)) throw new Error(`project.pluginType 只能是 effect 或 instrument，got ${pluginType}`)

    const productList = project.products === undefined ? ["standalone", "vst3"] : expectStringArray(project.products, "project.products")
    if (productList.length === 0) throw new Error("project.products 不能为空。")
    for (const product of productList) {
        if (!products.has(product)) throw new Error(`project.products 只支持 standalone 或 vst3，got ${product}`)
    }

    const packageManager = (ui.packageManager === undefined ? "pnpm" : expectString(ui.packageManager, "ui.packageManager")) as PackageManager
    if (!packageManagers.has(packageManager)) throw new Error(`ui.packageManager 只支持 pnpm 或 npm，got ${packageManager}`)

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
                generator: cmake.generator === undefined ? undefined : expectString(cmake.generator, "native.cmake.generator"),
                configureArgs: cmake.configureArgs === undefined ? [] : expectStringArray(cmake.configureArgs, "native.cmake.configureArgs"),
                buildArgs: cmake.buildArgs === undefined ? [] : expectStringArray(cmake.buildArgs, "native.cmake.buildArgs"),
            },
        },
        artifacts: {
            path: artifacts.path === undefined ? "artifacts" : expectString(artifacts.path, "artifacts.path"),
            includeVersionDir: artifacts.includeVersionDir === undefined ? true : expectBoolean(artifacts.includeVersionDir, "artifacts.includeVersionDir"),
        },
    }
}

export function stringifyConfig(config: ArrangeConfig): string {
    return [
        "arrange:",
        `  version: ${config.arrange.version}`,
        "",
        "project:",
        `  name: ${config.project.name}`,
        `  version: ${config.project.version}`,
        `  companyName: ${config.project.companyName}`,
        `  companyCode: ${config.project.companyCode}`,
        `  pluginCode: ${config.project.pluginCode}`,
        `  pluginType: ${config.project.pluginType}`,
        "  products:",
        ...config.project.products.map((product) => `    - ${product}`),
        "",
        "ui:",
        `  path: ${config.ui.path}`,
        `  packageManager: ${config.ui.packageManager}`,
        "",
        "native:",
        `  path: ${config.native.path}`,
        "  cmake:",
        `    buildDir: ${config.native.cmake.buildDir}`,
        ...(config.native.cmake.generator ? [`    generator: ${config.native.cmake.generator}`] : []),
        `    configureArgs: [${config.native.cmake.configureArgs.map((value) => JSON.stringify(value)).join(", ")}]`,
        `    buildArgs: [${config.native.cmake.buildArgs.map((value) => JSON.stringify(value)).join(", ")}]`,
        "",
        "artifacts:",
        `  path: ${config.artifacts.path}`,
        `  includeVersionDir: ${config.artifacts.includeVersionDir}`,
        "",
    ].join("\n")
}

function parseYaml(source: string): unknown {
    const root: Record<string, unknown> = {}
    const stack: Array<{indent: number; value: Record<string, unknown> | unknown[]}> = [{indent: -1, value: root}]
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/)
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const original = stripComment(lines[lineNumber]).replace(/\s+$/, "")
        if (!original.trim()) continue
        const indent = original.match(/^ */)?.[0].length ?? 0
        const text = original.trim()
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
        const parent = stack[stack.length - 1].value
        if (text.startsWith("- ")) {
            if (!Array.isArray(parent)) throw new Error(`YAML 第 ${lineNumber + 1} 行不是有效列表项。`)
            parent.push(parseScalar(text.slice(2).trim()))
            continue
        }
        const match = /^(?<key>[A-Za-z][A-Za-z0-9]*):(?:\s*(?<value>.*))?$/.exec(text)
        if (!match?.groups) throw new Error(`YAML 第 ${lineNumber + 1} 行无法解析：${lines[lineNumber]}`)
        if (Array.isArray(parent)) throw new Error(`YAML 第 ${lineNumber + 1} 行不能在列表中定义对象字段。`)
        const key = match.groups.key
        const rawValue = match.groups.value ?? ""
        if (rawValue === "") {
            const next = nextMeaningfulLine(lines, lineNumber + 1)
            const child: Record<string, unknown> | unknown[] = next && next.indent > indent && next.text.startsWith("- ") ? [] : {}
            parent[key] = child
            stack.push({indent, value: child})
        } else {
            parent[key] = parseScalar(rawValue)
        }
    }
    return root
}

function nextMeaningfulLine(lines: string[], start: number): {indent: number; text: string} | null {
    for (let index = start; index < lines.length; index++) {
        const line = stripComment(lines[index]).replace(/\s+$/, "")
        if (!line.trim()) continue
        return {indent: line.match(/^ */)?.[0].length ?? 0, text: line.trim()}
    }
    return null
}

function stripComment(line: string): string {
    let quote: string | null = null
    for (let index = 0; index < line.length; index++) {
        const char = line[index]
        if ((char === '"' || char === "'") && line[index - 1] !== "\\") quote = quote === char ? null : quote ?? char
        if (char === "#" && !quote) return line.slice(0, index)
    }
    return line
}

function parseScalar(value: string): unknown {
    if (value === "true") return true
    if (value === "false") return false
    if (value === "[]") return []
    if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim()
        if (!inner) return []
        return inner.split(",").map((item) => parseScalar(item.trim()))
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1)
    }
    return value
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
    return value as Record<string, unknown>
}

function optionalRecord(value: unknown): Record<string, unknown> {
    if (value === undefined) return {}
    return expectRecord(value, "配置项")
}

function assertKnownKeys(value: Record<string, unknown>, label: string, allowed: readonly string[]): void {
    const allowedSet = new Set(allowed)
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) throw new Error(`${label}: 未知字段 ${key}`)
    }
}

function expectString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${label} 必须是非空字符串。`)
    return value
}

function expectBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${label} 必须是 boolean。`)
    return value
}

function expectStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} 必须是字符串数组。`)
    return value as string[]
}
