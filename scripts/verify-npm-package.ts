import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {npmSubprocessEnv, repoRoot, run} from "./common.ts"
import {readArrangeVersionContract} from "./version-contract.ts"

const contract = readArrangeVersionContract()
const consumerDir = resolve(repoRoot, "build/npm-package-consumer")
const frameworkTarball = resolve(repoRoot, `artifacts/npm/arrange-framework-${contract.version}.tgz`)
const macroPattern = /\b__(?:DEV|TEST|BROWSER|SSR|GLOBAL|CJS|ESM_BROWSER|ESM_BUNDLER|COMPAT|FEATURE_[A-Z0-9_]+|VERSION)__\b/

async function runNpm(args: readonly string[]): Promise<void> {
    const env = npmSubprocessEnv()
    if (process.platform === "win32") {
        await run("cmd.exe", ["/d", "/c", "npm.cmd", ...args], {cwd: consumerDir, env})
        return
    }
    await run("npm", args, {cwd: consumerDir, env})
}

if (!existsSync(frameworkTarball)) {
    await import("./pack-npm-package.ts")
}

rmSync(consumerDir, {recursive: true, force: true})
mkdirSync(resolve(consumerDir, "src"), {recursive: true})
cpSync(resolve(repoRoot, "demo/ui-src/src"), resolve(consumerDir, "src"), {recursive: true})
writeFileSync(resolve(consumerDir, "package.json"), `${JSON.stringify({
    name: "arrange-npm-package-consumer",
    private: true,
    type: "module",
    scripts: {
        build: "arrange build --outDir dist --emptyOutDir",
    },
    dependencies: {
        "@arrange/framework": `file:../../artifacts/npm/arrange-framework-${contract.version}.tgz`,
    },
}, null, 2)}\n`)

await runNpm(["install"])
await runNpm(["run", "build"])

const appBundle = resolve(consumerDir, "dist/app.js")
if (!existsSync(appBundle)) throw new Error(`npm package consumer did not produce ${appBundle}`)
const source = readFileSync(appBundle, "utf8")
const macro = source.match(macroPattern)
if (macro) throw new Error(`npm package consumer bundle contains unresolved Arrange Vue macro ${macro[0]}`)

console.log(`verified @arrange/framework npm package consumer for Arrange ${contract.version}`)
