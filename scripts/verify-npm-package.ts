import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {npmSubprocessEnv, repoRoot, run} from "./common.ts"
import {readArrangeVersionContract} from "./version-contract.ts"

const contract = readArrangeVersionContract()
const consumerDir = resolve(repoRoot, "build/npm-package-consumer")
const frameworkTarball = resolve(repoRoot, `artifacts/npm/arrange-framework-${contract.frameworkVersion}.tgz`)
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

// 验证当前源码生成的发布包，不复用旧产物
await import("./pack-npm-package.ts")
if (!existsSync(frameworkTarball)) throw new Error(`缺少 Framework 发布包： ${frameworkTarball}`)
if (!existsSync(cliTarball)) throw new Error(`缺少 CLI 发布包： ${cliTarball}`)

rmSync(consumerDir, {recursive: true, force: true})
mkdirSync(resolve(consumerDir, "src"), {recursive: true})
cpSync(resolve(repoRoot, "demo/ui-src/src"), resolve(consumerDir, "src"), {recursive: true})
cpSync(resolve(repoRoot, "demo/ui-src/public"), resolve(consumerDir, "public"), {recursive: true})
cpSync(resolve(repoRoot, "demo/ui-src/vite.config.ts"), resolve(consumerDir, "vite.config.ts"))
writeFileSync(resolve(consumerDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, strict: true, lib: ["ES2022", "DOM"] }, include: ["src/**/*.ts", "src/**/*.sfa"] }, null, 4))
writeFileSync(resolve(consumerDir, "check.mts"), [
    "import { checkSfaProject } from '@arrange/framework/vite'",
    "const diagnostics = checkSfaProject('tsconfig.json', ['src'])",
    "if (diagnostics.length) throw new Error(JSON.stringify(diagnostics, null, 4))",
    "console.log('发布包 SFA 参数、内容与脚本类型检查通过')",
].join("\n"))
writeFileSync(resolve(consumerDir, "package.json"), `${JSON.stringify({
    name: "arrange-npm-package-consumer",
    private: true,
    type: "module",
    scripts: {
        build: "vite build --configLoader runner",
    },
    dependencies: {
        "@arrange/framework": `file:../../artifacts/npm/arrange-framework-${contract.frameworkVersion}.tgz`,
        "@arrange/cli": `file:../../artifacts/npm/arrange-cli-${cliManifest.version}.tgz`,
    },
}, null, 2)}\n`)

await runNpm(["install"])
await run(process.execPath, ["--import", import.meta.resolve("tsx"), "check.mts"], {cwd: consumerDir, env: npmSubprocessEnv()})
await runNpm(["run", "build"])

const appBundle = resolve(consumerDir, "dist/app.js")
if (!existsSync(appBundle)) throw new Error(`发布包消费者未生成产物： ${appBundle}`)
const source = readFileSync(appBundle, "utf8")
const macro = source.match(macroPattern)
if (macro) throw new Error(`发布包产物残留未替换的编译宏： ${macro[0]}`)

console.log(`Framework ${contract.frameworkVersion} 发布包的真实 SFA 类型检查与 Vite 生产构建通过，CLI ${cliManifest.version} 仅验证安装`)
