import {existsSync, readFileSync} from "node:fs"
import {resolve} from "node:path"

export function frameworkPackageRoot(uiRoot: string): string {
    const packageRoot = resolve(uiRoot, "node_modules", "@arrange", "framework")
    if (!existsSync(resolve(packageRoot, "package.json"))) throw new Error("The UI project has not installed @arrange/framework. Run arrange sync --ui first.")
    return packageRoot
}

export function readFrameworkPackageJson(uiRoot: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(frameworkPackageRoot(uiRoot), "package.json"), "utf8")) as Record<string, unknown>
}

export function readArrangeRegistryFromNpmrc(uiRoot: string): string | undefined {
    const npmrcPath = resolve(uiRoot, ".npmrc")
    if (!existsSync(npmrcPath)) return undefined
    const source = readFileSync(npmrcPath, "utf8")
    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue
        const match = /^@arrange:registry\s*=\s*(?<registry>.+)$/.exec(trimmed)
        const registry = match?.groups?.registry.trim()
        if (registry) return registry
    }
    return undefined
}

export function frameworkExportPath(uiRoot: string, exportName: "." | "./vite"): string {
    const root = frameworkPackageRoot(uiRoot)
    const manifest = readFrameworkPackageJson(uiRoot)
    const exportsField = manifest.exports
    if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) throw new Error("@arrange/framework does not define exports.")
    const target = (exportsField as Record<string, unknown>)[exportName]
    const path = exportTargetPath(target)
    return resolve(root, path)
}

function exportTargetPath(target: unknown): string {
    if (typeof target === "string") return normalizePackageRelative(target)
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("@arrange/framework export shape is invalid.")
    const record = target as Record<string, unknown>
    for (const key of ["arrange-ts", "import"] as const) {
        const value = record[key]
        if (typeof value === "string") return normalizePackageRelative(value)
    }
    throw new Error("@arrange/framework export is missing an arrange-ts/import entry.")
}

function normalizePackageRelative(path: string): string {
    if (!path.startsWith("./")) throw new Error(`@arrange/framework export is not package-relative: ${path}`)
    return path.slice(2)
}
