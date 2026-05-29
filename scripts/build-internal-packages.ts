import {existsSync, readdirSync, readFileSync, rmSync, statSync} from "node:fs"
import {resolve} from "node:path"
import {repoRoot} from "./common.ts"
import {assertArrangeVersionContract, readArrangeVersionContract} from "./version-contract.ts"

type PackageManifest = {
    name?: unknown
    version?: unknown
    arrange?: unknown
    bin?: unknown
    private?: unknown
    exports?: unknown
    main?: unknown
    module?: unknown
    types?: unknown
    files?: unknown
    publishConfig?: unknown
    dependencies?: unknown
    devDependencies?: unknown
    peerDependencies?: unknown
    bundledDependencies?: unknown
    bundleDependencies?: unknown
    unpkg?: unknown
    jsdelivr?: unknown
}

type ExportTarget = string | Record<string, unknown>

const packagesRoot = resolve(repoRoot, "packages")
const cliPackagePath = resolve(repoRoot, "cli", "package.json")
const forbiddenPublicFields = ["main", "module", "types", "unpkg", "jsdelivr"] as const
const forbiddenExportKeys = new Set(["types", "require", "default"])
const allowedExportKeys = new Set(["arrange-ts", "import"])
const macroPattern = /\b__(?:DEV|TEST|BROWSER|SSR|GLOBAL|CJS|ESM_BROWSER|ESM_BUNDLER|COMPAT|FEATURE_[A-Z0-9_]+|VERSION)__\b/
const internalPackagePattern = /^@arrange\//
const publicPackageNames = new Set(["@arrange/framework"])
const publicBundleDeps = new Map<string, readonly string[]>([
    ["@arrange/framework", [
        "@arrange/runtime",
        "@arrange/vite-plugin",
        "@arrange/vue-reactivity",
        "@arrange/vue-runtime-core",
        "@arrange/vue-compiler-arrange",
        "@arrange/vue-compiler-core",
        "@arrange/vue-compiler-sfc",
        "@arrange/vue-shared",
    ]],
])

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
    if ("bin" in manifest) fail(`${pkgName} must not declare CLI bin; Arrange CLI lives in @arrange/cli`)
    if (Array.isArray(manifest.files) && manifest.files.some((item) => String(item).includes("dist"))) {
        fail(`${pkgName} must not publish dist in files`)
    }
}

function dependencyEntries(manifest: PackageManifest): Array<[string, string, string]> {
    const fields = ["dependencies", "devDependencies", "peerDependencies"] as const
    const entries: Array<[string, string, string]> = []
    for (const field of fields) {
        const deps = manifest[field]
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue
        for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
            if (typeof spec === "string") entries.push([field, name, spec])
        }
    }
    return entries
}

function assertNoWorkspaceOrCatalogSpecs(manifest: PackageManifest, pkgName: string): void {
    for (const [field, name, spec] of dependencyEntries(manifest)) {
        if (spec.startsWith("workspace:") || spec === "catalog:") {
            fail(`${pkgName} ${field}.${name} leaks non-publishable spec ${spec}`)
        }
    }
}

function assertPublicPackageContract(manifest: PackageManifest, pkgName: string): void {
    if (!publicPackageNames.has(pkgName)) return
    if (manifest.private === true) fail(`${pkgName} is a public package but private=true`)
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail(`${pkgName} must constrain npm publish files`)
    const publishConfig = manifest.publishConfig
    if (!publishConfig || typeof publishConfig !== "object") fail(`${pkgName} must declare publishConfig`)
    const publishRecord = publishConfig as Record<string, unknown>
    if (publishRecord.access !== "public") fail(`${pkgName} publishConfig.access must be public`)
    if (publishRecord.tag !== "m") fail(`${pkgName} publishConfig.tag must be m for milestone packages`)

    const expectedBundleDeps = publicBundleDeps.get(pkgName) ?? []
    const actual = manifest.bundledDependencies ?? manifest.bundleDependencies
    if (!Array.isArray(actual)) fail(`${pkgName} must bundle internal Arrange Vue packages`)
    const actualNames = new Set(actual.map(String))
    for (const dep of expectedBundleDeps) {
        if (!actualNames.has(dep)) fail(`${pkgName} must bundle ${dep}`)
    }

    if (pkgName === "@arrange/framework") {
        const arrange = manifest.arrange
        if (!arrange || typeof arrange !== "object" || Array.isArray(arrange)) {
            fail(`${pkgName} must declare arrange package metadata`)
        }
        const compatibility = (arrange as Record<string, unknown>).cliCompatibility
        if (typeof compatibility !== "number" || !Number.isInteger(compatibility) || compatibility <= 0) {
            fail(`${pkgName} arrange.cliCompatibility must be a positive integer`)
        }
    }
}

function assertCliPackageContract(): void {
    const manifest = readJson(cliPackagePath)
    if (manifest.name !== "@arrange/cli") fail("cli/package.json must publish @arrange/cli")
    if (manifest.version !== contract.cliVersion) fail(`@arrange/cli version must be ${contract.cliVersion}`)
    if (manifest.private === true) fail("@arrange/cli must be publishable")
    const bin = manifest.bin
    if (!bin || typeof bin !== "object" || Array.isArray(bin) || (bin as Record<string, unknown>).arrange !== "./bin/arrange.cjs") {
        fail("@arrange/cli must own arrange bin at ./bin/arrange.cjs")
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes("src") || !manifest.files.includes("bin")) {
        fail("@arrange/cli must publish src and bin files")
    }
    const publishConfig = manifest.publishConfig
    if (!publishConfig || typeof publishConfig !== "object" || (publishConfig as Record<string, unknown>).access !== "public") {
        fail("@arrange/cli publishConfig.access must be public")
    }
    assertNoWorkspaceOrCatalogSpecs(manifest, "@arrange/cli")
    for (const [, name] of dependencyEntries(manifest)) {
        if (name === "@arrange/framework") fail("@arrange/cli must not directly depend on @arrange/framework")
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
    const source = readFileSync(path, "utf8")
    const match = source.match(macroPattern)
    if (match) fail(`unresolved Arrange Vue macro in app bundle ${path}: ${match[0]}`)
}

function assertNoMacrosInBuiltDemoBundle(): void {
    const candidates = [
        resolve(repoRoot, "build", "demo-ui-dist", "app.js"),
        resolve(repoRoot, "demo", "plugin-src", "ui", "app.js"),
    ]
    const bundle = candidates.find((path) => existsSync(path))
    if (!bundle) fail(`missing Arrange app bundle; run build:demo-ui before package boundary verification`)
    assertNoMacrosInBundle(bundle)
}

const packageDirs = readdirSync(packagesRoot)
    .map((name) => resolve(packagesRoot, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(resolve(path, "package.json")))

const contract = readArrangeVersionContract()
assertArrangeVersionContract()

for (const pkgDir of packageDirs) {
    const manifest = readJson(resolve(pkgDir, "package.json"))
    const pkgName = typeof manifest.name === "string" ? manifest.name : fail(`${pkgDir} missing package name`)
    if (!internalPackagePattern.test(pkgName)) fail(`${pkgName} is not an Arrange internal package`)
    if (manifest.version !== contract.frameworkVersion) fail(`${pkgName} version must be ${contract.frameworkVersion}`)
    assertNoPublicDistFields(manifest, pkgName)
    assertNoWorkspaceOrCatalogSpecs(manifest, pkgName)
    assertPublicPackageContract(manifest, pkgName)
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

assertNoMacrosInBuiltDemoBundle()
assertCliPackageContract()
console.log("verified TS-first package and publish boundary contract")
