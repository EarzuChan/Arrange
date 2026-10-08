import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { delimiter, dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { npmSubprocessEnv, repoRoot } from "./common.ts"
import { readArrangeVersionContract } from "./version-contract.ts"
import { ARRANGE_MACRO_PATTERN } from "../packages/vite-plugin/src/constraints.ts"
import { defaultNodeRegistryUrl, defaultProjectDirectories } from "../cli/src/CliMetadata.ts"
import { ProjectInitializer } from "../cli/src/project/ProjectInitializer.ts"
import { ProjectStateStore } from "../cli/src/project/ProjectStateStore.ts"
import { uiOutputDirectory } from "../cli/src/project/ProjectPaths.ts"
import { FileTransaction } from "../cli/src/util/FileTransaction.ts"
import { configRegistry } from "../cli/src/config/ConfigRegistry.ts"
import { Executor } from "../cli/src/platform/Executor.ts"
import { createPlatformService } from "../cli/src/platform/CreatePlatformService.ts"
import { ToolchainService } from "../cli/src/platform/ToolchainService.ts"
import { environmentValue } from "../cli/src/platform/ToolLocator.ts"
import type { ProcessSpec } from "../cli/src/platform/ProcessSpec.ts"

const contract = readArrangeVersionContract()
const cliManifest = JSON.parse(await readFile(resolve(repoRoot, "cli/package.json"), "utf8")) as { version: string }
const cliTarball = resolve(repoRoot, `artifacts/npm/arrange-cli-${cliManifest.version}.tgz`)
const registryUrl = process.env.ARRANGE_NPM_REGISTRY?.trim() || defaultNodeRegistryUrl

// 验证本次源码生成的安装包，由既有打包入口负责生成
await import("./pack-npm-package.ts")
await access(cliTarball)

const directory = await mkdtemp(join(tmpdir(), "arrange-registry-consumer-"))
const consumerDir = join(directory, "project")
const launcherDir = join(directory, "launcher")
const executor = new Executor()
const platform = createPlatformService(executor)
const tools = new ToolchainService(executor, platform)

async function execute(spec: ProcessSpec): Promise<void> {
    const result = await executor.run({ ...spec, stdio: "inherit" })
    if (result.exitCode !== 0) throw new Error(`安装包验收命令未成功（${result.exitCode}）：${spec.command} ${spec.args.join(" ")}`)
}

try {
    const state = await new ProjectInitializer(new FileTransaction()).create({
        rootDir: consumerDir,
        projectName: "RegistryConsumer",
        projectVersion: "0.1.0",
        frameworkVersion: contract.frameworkVersion,
        frameworkNodeRegistryUrl: registryUrl,
        vendorName: "Arrange",
        vendorCode: "Arng",
        pluginCode: "RegC",
        pluginType: "effect",
        packageManager: "npm",
        products: ["standalone"],
        uiDirectory: defaultProjectDirectories.ui,
        nativeDirectory: defaultProjectDirectories.native,
        artifactsDirectory: defaultProjectDirectories.artifacts,
        managedItems: Object.fromEntries(configRegistry.items.map(item => [item.id, true])),
    })
    const inspection = await tools.inspect(state, "UI")
    if (inspection.issues.length) throw new Error(inspection.issues.map(issue => issue.message).join("\n"))
    state.local = inspection.local
    const store = new ProjectStateStore(new FileTransaction())
    const scanned = await store.deepLoad(consumerDir)
    if (scanned.errors.length) throw new Error(scanned.errors.map(issue => issue.message).join("\n"))
    await store.saveLocal(consumerDir, inspection.local, scanned.snapshots)

    await mkdir(launcherDir)
    await writeFile(join(launcherDir, "package.json"), `${JSON.stringify({ name: "arrange-registry-cli-launcher", private: true, type: "module", dependencies: { "@arrange/cli": `file:${cliTarball}` } }, null, 4)}\n`)
    const env: Record<string, string> = Object.fromEntries(Object.entries(npmSubprocessEnv()).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    env.PATH = [dirname(inspection.local.node!.path), dirname(inspection.local.packageManager!.path), environmentValue(env, "PATH") ?? ""].join(delimiter)
    env.npm_config_registry = defaultNodeRegistryUrl
    await execute({ command: inspection.local.packageManager!.path, args: ["install", "--save-exact", "--registry", defaultNodeRegistryUrl], cwd: launcherDir, env })

    const installedCli = join(launcherDir, "node_modules", "@arrange", "cli", "dist", "Entry.js")
    await access(installedCli)
    const rejected = await executor.run({ command: inspection.local.node!.path, args: [installedCli, "--help"], cwd: consumerDir, env: { ...env, NODE_ENV: "test" }, stdio: "capture" })
    if (rejected.exitCode !== 1 || !rejected.stderr.includes("TTY")) throw new Error(`正式 CLI 未拒绝非 TTY 调用：${rejected.stdout}${rejected.stderr}`)

    const applicationUrl = pathToFileURL(join(dirname(installedCli), "CliApplication.js")).href
    const runner = join(launcherDir, "verify-cli.mjs")
    await writeFile(runner, `import { createCliApplication } from ${JSON.stringify(applicationUrl)}
const controller = new AbortController()
const interrupt = () => controller.abort()
const refuse = async () => { throw new Error("安装包自动化验收遇到未安排的交互") }
const message = value => console.log("[ArrangePackageVerify]", value)
const failure = value => { throw new Error(value) }
const interactions = {
    project: { create: refuse, adopt: refuse, confirmInitialization: refuse, confirm: refuse, message, failure },
    config: { report: report => message(\`CONFIG Fatal \${report.fatal.length}, Resolvable \${report.resolvable.length}, Applicable \${report.applicable.length}\`), choose: refuse, edit: refuse, message, failure },
    setup: { report: report => message(\`SETUP Fatal \${report.fatal.length}, Resolvable \${report.resolvable.length}, Applicable \${report.applicable.length}\`), acceptTools: refuse, editTools: refuse, message, failure },
}
process.on("SIGINT", interrupt)
process.on("SIGTERM", interrupt)
try {
    await createCliApplication({ signal: controller.signal, interactions }).exitOverride().parseAsync(process.argv)
} finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
}
`, "utf8")
    const runCli = (args: string[]): Promise<void> => execute({ command: inspection.local.node!.path, args: [runner, ...args], cwd: consumerDir, env })
    await runCli(["sync", "--scan", "--config", "--ui"])
    await runCli(["sync", "--setup", "--ui"])
    await runCli(["build", "--ui-only"])

    const appBundle = join(uiOutputDirectory(state), "app.js")
    const source = await readFile(appBundle, "utf8")
    const macro = source.match(ARRANGE_MACRO_PATTERN)
    if (macro) throw new Error(`注册表消费者产物残留 Arrange 编译宏：${macro[0]}`)
    console.log("[ArrangePackageVerify]", `Framework ${contract.frameworkVersion} 已从 ${registryUrl} 安装，CLI ${cliManifest.version} 正式入口已拒绝非 TTY，安装包的程序化入口已通过 CONFIG 扫描、SETUP 与 UI 构建验收`)
    await rm(directory, { recursive: true, force: true })
} catch (error) {
    console.error("[ArrangePackageVerify]", `验收失败，临时工程保留于 ${directory}`)
    throw error
}
