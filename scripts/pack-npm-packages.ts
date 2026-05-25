import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs"
import {basename, dirname, resolve} from "node:path"
import {npmSubprocessEnv, repoRoot, run} from "./common.ts"
import {assertArrangeVersionContract, readArrangeVersionContract} from "./version-contract.ts"

type PackageSpec = {
    sourceDir: string
    bundleDirs: string[]
}

const artifactsDir = resolve(repoRoot, "artifacts/npm")
const stagingRoot = resolve(artifactsDir, "staging")
const packageSpecs: PackageSpec[] = [
    {
        sourceDir: resolve(repoRoot, "packages/runtime"),
        bundleDirs: [
            resolve(repoRoot, "packages/arrange-vue-reactivity"),
            resolve(repoRoot, "packages/arrange-vue-runtime-core"),
            resolve(repoRoot, "packages/arrange-vue-shared"),
        ],
    },
    {
        sourceDir: resolve(repoRoot, "packages/vite-plugin"),
        bundleDirs: [
            resolve(repoRoot, "packages/arrange-vue-compiler-arrange"),
            resolve(repoRoot, "packages/arrange-vue-compiler-core"),
            resolve(repoRoot, "packages/arrange-vue-compiler-sfc"),
            resolve(repoRoot, "packages/arrange-vue-shared"),
        ],
    },
]

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function writeJson(path: string, value: Record<string, unknown>): void {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function runNpm(args: readonly string[]): Promise<void> {
    const env = npmSubprocessEnv()
    if (process.platform === "win32") {
        await run("cmd.exe", ["/d", "/c", "npm.cmd", ...args], {env})
        return
    }
    await run("npm", args, {env})
}

function copyIfExists(source: string, target: string): void {
    if (!existsSync(source)) return
    cpSync(source, target, {
        recursive: true,
        filter: (path) => !path.includes(`${resolve(source, "node_modules")}`),
    })
}

function copyPackageSource(sourceDir: string, targetDir: string): void {
    mkdirSync(targetDir, {recursive: true})
    for (const item of ["src", "bin", "LICENSE", "README.md", "UPSTREAM.md"]) {
        copyIfExists(resolve(sourceDir, item), resolve(targetDir, item))
    }
    const manifest = readJson(resolve(sourceDir, "package.json"))
    writeJson(resolve(targetDir, "package.json"), manifest)
}

function packageStageName(sourceDir: string): string {
    const manifest = readJson(resolve(sourceDir, "package.json"))
    const rawName = String(manifest.name ?? basename(sourceDir))
    return rawName.replace(/^@/, "").replaceAll("/", "-")
}

function assertStagedTreeClean(stageDir: string): void {
    const badPatterns = [/[/\\]__tests__[/\\]/, /[/\\]__benchmarks__[/\\]/, /[/\\]dist[/\\]/]
    const stack = [stageDir]
    while (stack.length) {
        const current = stack.pop()!
        for (const item of readdirSync(current)) {
            const path = resolve(current, item)
            const relative = path.slice(stageDir.length)
            if (badPatterns.some((pattern) => pattern.test(relative))) {
                throw new Error(`staged npm package contains non-publish source: ${path}`)
            }
            const stat = statSync(path)
            if (stat.isDirectory()) stack.push(path)
        }
    }
}

assertArrangeVersionContract()
const contract = readArrangeVersionContract()

rmSync(stagingRoot, {recursive: true, force: true})
mkdirSync(artifactsDir, {recursive: true})
mkdirSync(stagingRoot, {recursive: true})

for (const spec of packageSpecs) {
    const stageDir = resolve(stagingRoot, packageStageName(spec.sourceDir))
    copyPackageSource(spec.sourceDir, stageDir)

    const arrangeScopeDir = resolve(stageDir, "node_modules/@arrange")
    mkdirSync(arrangeScopeDir, {recursive: true})
    for (const bundleDir of spec.bundleDirs) {
        copyPackageSource(bundleDir, resolve(arrangeScopeDir, basename(bundleDir).replace(/^arrange-/, "")))
    }

    assertStagedTreeClean(stageDir)
    await runNpm(["pack", stageDir, "--pack-destination", artifactsDir])
}

console.log(`packed Arrange npm packages ${contract.version} into ${artifactsDir}`)
