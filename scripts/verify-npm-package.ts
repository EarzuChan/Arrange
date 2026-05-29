import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {npmSubprocessEnv, repoRoot, run} from "./common.ts"
import {readArrangeVersionContract} from "./version-contract.ts"

const contract = readArrangeVersionContract()
const consumerDir = resolve(repoRoot, "build/npm-package-consumer")
const frameworkTarball = resolve(repoRoot, `artifacts/npm/arrange-framework-${contract.version}.tgz`)
const cliManifest = JSON.parse(readFileSync(resolve(repoRoot, "cli/package.json"), "utf8")) as {version: string}
const cliTarball = resolve(repoRoot, `artifacts/npm/arrange-cli-${cliManifest.version}.tgz`)
const macroPattern = /\b__(?:DEV|TEST|BROWSER|SSR|GLOBAL|CJS|ESM_BROWSER|ESM_BUNDLER|COMPAT|FEATURE_[A-Z0-9_]+|VERSION)__\b/

async function runNpm(args: readonly string[]): Promise<void> {
    const env = npmSubprocessEnv()
    if (process.platform === "win32") {
        await run("cmd.exe", ["/d", "/c", "npm.cmd", ...args], {cwd: consumerDir, env})
        return
    }
    await run("npm", args, {cwd: consumerDir, env})
}

if (!existsSync(frameworkTarball) || !existsSync(cliTarball)) {
    await import("./pack-npm-package.ts")
}
if (!existsSync(frameworkTarball)) throw new Error(`missing framework tarball: ${frameworkTarball}`)
if (!existsSync(cliTarball)) throw new Error(`missing CLI tarball: ${cliTarball}`)

rmSync(consumerDir, {recursive: true, force: true})
mkdirSync(resolve(consumerDir, "src"), {recursive: true})
cpSync(resolve(repoRoot, "demo/ui-src/src"), resolve(consumerDir, "src"), {recursive: true})
writeFileSync(resolve(consumerDir, "arrange.config.yaml"), [
    "arrange:",
    `  version: ${contract.version}`,
    "",
    "project:",
    "  name: PackageConsumer",
    "  version: 0.1.0",
    "  companyName: Arrange",
    "  companyCode: Arng",
    "  pluginCode: PkgC",
    "  pluginType: effect",
    "  products:",
    "    - standalone",
    "",
    "ui:",
    "  path: .",
    "  packageManager: npm",
    "",
    "native:",
    "  path: native",
    "  cmake:",
    "    buildDir: build",
    "    configureArgs: []",
    "    buildArgs: []",
    "",
    "artifacts:",
    "  path: artifacts",
    "  includeVersionDir: true",
    "",
].join("\n"))
writeFileSync(resolve(consumerDir, "package.json"), `${JSON.stringify({
    name: "arrange-npm-package-consumer",
    private: true,
    type: "module",
    scripts: {
        build: "arrange build --ui-only",
    },
    dependencies: {
        "@arrange/framework": `file:../../artifacts/npm/arrange-framework-${contract.version}.tgz`,
        "@arrange/cli": `file:../../artifacts/npm/arrange-cli-${cliManifest.version}.tgz`,
    },
}, null, 2)}\n`)

await runNpm(["install"])
await runNpm(["run", "build"])

const appBundle = resolve(consumerDir, "dist/app.js")
if (!existsSync(appBundle)) throw new Error(`npm package consumer did not produce ${appBundle}`)
const source = readFileSync(appBundle, "utf8")
const macro = source.match(macroPattern)
if (macro) throw new Error(`npm package consumer bundle contains unresolved Arrange Vue macro ${macro[0]}`)

console.log(`verified @arrange/framework ${contract.version} and @arrange/cli ${cliManifest.version} npm package consumer`)
