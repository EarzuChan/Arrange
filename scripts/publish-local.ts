import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { npmSubprocessEnv, repoRoot, run } from "./common.ts"
import { assertArrangeVersionContract, isDevFrameworkVersion, readArrangeVersionContract } from "./version-contract.ts"

// 本机发包：把当前提交的 Framework 以 dev 版本发到本机 Verdaccio，并在本仓库打对应的本地 dev tag
// 只服务本机验证，dev tag 不推送远端，dev 包不发布到公共 registry

const defaultLocalRegistry = "http://localhost:4873"
const registry = readOption("--registry") ?? defaultLocalRegistry

function readOption(name: string): string | undefined {
    const index = process.argv.indexOf(name)
    if (index < 0) return undefined
    const value = process.argv[index + 1]
    if (!value) throw new Error(`${name} 需要参数`)
    return value
}

function git(args: readonly string[]): string {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim()
}

async function assertRegistryReachable(): Promise<void> {
    try {
        const response = await fetch(new URL("/-/ping", registry), { signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } catch (error) {
        throw new Error(`本机 registry ${registry} 不可用（${error instanceof Error ? error.message : String(error)}）；请先启动 Verdaccio，例如 npx verdaccio`, { cause: error })
    }
}

assertArrangeVersionContract()
const { frameworkVersion } = readArrangeVersionContract()
const tag = `v${frameworkVersion}`
if (!isDevFrameworkVersion(frameworkVersion)) throw new Error(`本机发包只接受 dev 版本（0.0.0-m.<N>.<sub>-dev.<K>），当前为 ${frameworkVersion}`)
if (git(["status", "--porcelain"])) throw new Error("工作区有未提交改动；dev tag 必须对应已提交的源码，请先提交")
if (git(["tag", "--list", tag])) throw new Error(`本地已存在 tag ${tag}；请在 arrange.version.json 递增 dev 号并执行 pnpm sync:version 后提交`)
await assertRegistryReachable()

await run(process.execPath, ["--import", "tsx", "scripts/pack-npm-package.ts"])
const tarball = resolve(repoRoot, "artifacts/npm", `arrange-framework-${frameworkVersion}.tgz`)
if (!existsSync(tarball)) throw new Error(`未找到打包产物：${tarball}`)
const npmArgs = ["publish", tarball, "--registry", registry, "--tag", "dev"]
if (process.platform === "win32") await run("cmd.exe", ["/d", "/c", "npm.cmd", ...npmArgs], { env: npmSubprocessEnv() })
else await run("npm", npmArgs, { env: npmSubprocessEnv() })

// 轻量 tag 不会被 git push --follow-tags 带到远端
git(["tag", tag])
console.log("[ArrangeLocalPublish]", `已发布 @arrange/framework@${frameworkVersion} 到 ${registry}，并创建本地 tag ${tag}（不要推送）`)
