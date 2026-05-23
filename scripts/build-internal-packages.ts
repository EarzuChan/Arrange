import {existsSync, readdirSync, readFileSync, rmSync, statSync} from "node:fs"
import {resolve} from "node:path"
import {repoRoot} from "./common.ts"

type PackageManifest = {
    name?: unknown
    exports?: unknown
    main?: unknown
    module?: unknown
    types?: unknown
    files?: unknown
    unpkg?: unknown
    jsdelivr?: unknown
}

type ExportTarget = string | Record<string, unknown>

const packagesRoot = resolve(repoRoot, "packages")
const forbiddenPublicFields = ["main", "module", "types", "unpkg", "jsdelivr"] as const
const forbiddenExportKeys = new Set(["types", "require", "default"])
const allowedExportKeys = new Set(["arrange-ts", "import"])
const macroPattern = /\b__(?:DEV|TEST|BROWSER|SSR|GLOBAL|CJS|ESM_BROWSER|ESM_BUNDLER|COMPAT|FEATURE_[A-Z0-9_]+|VERSION)__\b/
const internalPackagePattern = /^@arrange\//

function fail(message: string): never {
    throw new Error(message)
}

function readJson(path: string): PackageManifest {
    return JSON.parse(readFileSync(path, "utf8")) as PackageManifest
}

function assertTsEntry(pkgDir: string, pkgName: string, target: unknown, path: string): void {
    if (typeof target !== "string") fail(`${pkgName} export ${path} must be a direct TS path string`)
    if (!target.startsWith("./")) fail(`${pkgName} export ${path} must be package-relative`)
    if (!target.endsWith(".ts")) fail(`${pkgName} export ${path} must point to .ts, got ${target}`)
    if (target.includes("/dist/") || target.startsWith("./dist/")) fail(`${pkgName} export ${path} points to dist: ${target}`)
    const entryPath = resolve(pkgDir, target)
    if (!existsSync(entryPath)) fail(`${pkgName} export ${path} target does not exist: ${target}`)
}

function assertExportTarget(pkgDir: string, pkgName: string, target: ExportTarget, path: string): void {
    if (typeof target === "string") {
        assertTsEntry(pkgDir, pkgName, target, path)
        return
    }
    for (const [key, value] of Object.entries(target)) {
        if (forbiddenExportKeys.has(key)) fail(`${pkgName} export ${path}.${key} is forbidden in TS-first packages`)
        if (!allowedExportKeys.has(key)) fail(`${pkgName} export ${path}.${key} is not an Arrange TS-first condition`)
        if (typeof value === "string") assertTsEntry(pkgDir, pkgName, value, `${path}.${key}`)
        else if (value && typeof value === "object") assertExportTarget(pkgDir, pkgName, value as ExportTarget, `${path}.${key}`)
        else fail(`${pkgName} export ${path}.${key} has invalid target`)
    }
}

function assertNoDistDirectory(pkgDir: string, pkgName: string): void {
    const distPath = resolve(pkgDir, "dist")
    if (!existsSync(distPath)) return
    rmSync(distPath, {recursive: true, force: true})
    if (existsSync(distPath)) fail(`${pkgName} dist directory remains after removal`)
    console.log(`removed forbidden package dist: ${pkgName}`)
}

function assertNoPublicDistFields(manifest: PackageManifest, pkgName: string): void {
    for (const field of forbiddenPublicFields) {
        if (field in manifest) fail(`${pkgName} must not declare public ${field}`)
    }
    if (Array.isArray(manifest.files) && manifest.files.some((item) => String(item).includes("dist"))) {
        fail(`${pkgName} must not publish dist in files`)
    }
}

function assertNoSourceDirectInternalImports(path: string, source: string): void {
    const directImportPattern = /from\s+["'](@arrange\/[^"']*\/(?:src|dist)\/[^"']*)["']|import\s*\(\s*["'](@arrange\/[^"']*\/(?:src|dist)\/[^"']*)["']\s*\)/g
    let match: RegExpExecArray | null
    while ((match = directImportPattern.exec(source))) {
        fail(`${path} bypasses package exports: ${match[1] ?? match[2]}`)
    }
}

function walkFiles(dir: string, visit: (path: string) => void): void {
    if (!existsSync(dir)) return
    for (const item of readdirSync(dir)) {
        const path = resolve(dir, item)
        const stat = statSync(path)
        if (stat.isDirectory()) {
            if (item === "node_modules" || item === ".git" || item === "build" || item === "artifacts") continue
            walkFiles(path, visit)
        } else {
            visit(path)
        }
    }
}

function assertNoMacrosInBundle(path: string): void {
    if (!existsSync(path)) fail(`missing Arrange app bundle: ${path}`)
    const source = readFileSync(path, "utf8")
    const match = source.match(macroPattern)
    if (match) fail(`unresolved Arrange Vue macro in app bundle ${path}: ${match[0]}`)
}

const packageDirs = readdirSync(packagesRoot)
    .map((name) => resolve(packagesRoot, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(resolve(path, "package.json")))

for (const pkgDir of packageDirs) {
    const manifest = readJson(resolve(pkgDir, "package.json"))
    const pkgName = typeof manifest.name === "string" ? manifest.name : fail(`${pkgDir} missing package name`)
    if (!internalPackagePattern.test(pkgName)) fail(`${pkgName} is not an Arrange internal package`)
    assertNoPublicDistFields(manifest, pkgName)
    if (!manifest.exports || typeof manifest.exports !== "object") fail(`${pkgName} must declare package exports`)
    for (const [key, target] of Object.entries(manifest.exports as Record<string, ExportTarget>)) {
        assertExportTarget(pkgDir, pkgName, target, `exports.${key}`)
    }
    assertNoDistDirectory(pkgDir, pkgName)
}

for (const root of ["packages", "demo/ui-src", "scripts", "tests"]) {
    walkFiles(resolve(repoRoot, root), (path) => {
        if (!/\.(?:ts|tsx|js|jsx|vue|json)$/.test(path)) return
        if (path.endsWith("package.json")) return
        assertNoSourceDirectInternalImports(path, readFileSync(path, "utf8"))
    })
}

assertNoMacrosInBundle(resolve(repoRoot, "demo", "plugin-src", "ui", "app.js"))
console.log("verified TS-first internal package contract")
