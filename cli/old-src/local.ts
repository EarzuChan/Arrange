import {existsSync, readFileSync, writeFileSync} from "node:fs"
import {basename, delimiter, dirname, isAbsolute, join, resolve} from "node:path"
import {stdin as input, stdout as output} from "node:process"
import {createInterface} from "node:readline/promises"
import type {ArrangeConfig, PackageManager} from "./config.ts"
import {assertKnownKeys, expectRecord, expectString, expectStringArray, optionalRecord, parseYaml, stringifyYaml} from "./config.ts"
import {runCaptureSync, runQuiet} from "./process.ts"

export const LOCAL_CONFIG_FILE = "arrange.local.yaml"

export type LocalPlatform = "windows" | "macos"

export type LocalConfig = {
    platform: LocalPlatform
    windows?: WindowsLocalConfig
    macos?: MacosLocalConfig
}

export type WindowsLocalConfig = {
    shell: {command: string}
    packageManager: {command: string}
    cmake?: LocalCMakeConfig
    msvc?: {
        devCmd: string
        arch: string
        hostArch: string
    }
}

export type MacosLocalConfig = {
    shell: {command: string}
    packageManager: {command: string}
    cmake?: LocalCMakeConfig
}

export type LocalCMakeConfig = {
    command: string
    generator: string
    makeProgram?: string
    configureArgs: string[]
    buildArgs: string[]
}

export type ToolchainNeed = {
    ui?: boolean
    native?: boolean
}

export type EnsureToolchainOptions = {
    interactive?: boolean
    write?: boolean
}

export type ResolvedToolchain = {
    platform: LocalPlatform
    shellCommand: string
    packageManagerCommand?: string
    cmake?: LocalCMakeConfig
    msvc?: {
        devCmd: string
        arch: string
        hostArch: string
    }
}

const PROJECT_GITIGNORE_ENTRIES = [
    "arrange.local.yaml",
    "artifacts/",
    "node_modules/",
    "dist/",
    "coverage/",
    ".vite/",
    ".turbo/",
    ".cache/",
    "tmp/",
    "temp/",
    "*.tsbuildinfo",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    "pnpm-debug.log*",
    "build/",
    "cmake-build-*/",
    "CMakeFiles/",
    "CMakeCache.txt",
    "cmake_install.cmake",
    "compile_commands.json",
    ".ninja_deps",
    ".ninja_log",
    "*.o",
    "*.obj",
    "*.a",
    "*.lib",
    "*.so",
    "*.dylib",
    "*.dll",
    "*.exe",
    "*.pdb",
    "*.ilk",
    "*.exp",
    "*.tmp",
    "*.temp",
    "*.bak",
    "*.swp",
    "*.swo",
    ".DS_Store",
    "Thumbs.db",
    ".vs/",
    "*.user",
]

type DiscoveryIssue = {
    field: string
    message: string
    candidates?: string[]
}

export function localConfigPath(cwd = process.cwd()): string {
    return resolve(cwd, LOCAL_CONFIG_FILE)
}

export function readLocalConfig(cwd = process.cwd()): LocalConfig | null {
    const path = localConfigPath(cwd)
    if (!existsSync(path)) return null
    return normalizeLocalConfig(parseYaml(readFileSync(path, "utf8")), path)
}

export function writeLocalConfig(config: LocalConfig, cwd = process.cwd()): void {
    writeFileSync(localConfigPath(cwd), stringifyLocalConfig(config))
    ensureLocalGitignore(cwd)
}

export function ensureLocalGitignore(cwd = process.cwd()): void {
    ensureProjectGitignore(cwd)
}

export function ensureProjectGitignore(cwd = process.cwd(), check = false): boolean {
    const path = resolve(cwd, ".gitignore")
    const source = existsSync(path) ? readFileSync(path, "utf8") : ""
    const lines = source.split(/\r?\n/).map((line) => line.trim())
    const missing = PROJECT_GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry))
    if (missing.length === 0) return false
    if (check) return true
    const prefix = source.length > 0 && !source.endsWith("\n") ? "\n" : ""
    const separator = source.length > 0 ? "\n" : ""
    writeFileSync(path, `${source}${prefix}${separator}${missing.join("\n")}\n`)
    return true
}

export async function ensureToolchain(config: ArrangeConfig, cwd: string, need: ToolchainNeed, options: EnsureToolchainOptions = {}): Promise<ResolvedToolchain> {
    const existing = safeReadLocalConfig(cwd)
    const platform = currentLocalPlatform()
    const local = existing ?? emptyLocalConfig(platform)
    local.platform = platform
    let issues = reconcileLocalConfig(local, config.ui.packageManager, need)
    if (issues.length > 0 && shouldPrompt(options)) {
        await promptForLocalConfig(local, config.ui.packageManager, need, issues)
        issues = reconcileLocalConfig(local, config.ui.packageManager, need)
    }
    if (issues.length > 0) throw new Error([
        `${LOCAL_CONFIG_FILE} cannot satisfy the current command.`,
        ...issues.map(formatIssue),
        "Install missing tools, or fix arrange.local.yaml as described above, then retry.",
    ].join("\n"))

    let resolved = resolveToolchain(local, need)
    let verifyIssues = await verifyToolchain(resolved, config.ui.packageManager, need)
    if (verifyIssues.length > 0 && shouldPrompt(options)) {
        await promptForLocalConfig(local, config.ui.packageManager, need, verifyIssues)
        issues = reconcileLocalConfig(local, config.ui.packageManager, need)
        if (issues.length > 0) throw new Error([
            `${LOCAL_CONFIG_FILE} cannot satisfy the current command.`,
            ...issues.map(formatIssue),
            "Install missing tools, or fix arrange.local.yaml as described above, then retry.",
        ].join("\n"))
        resolved = resolveToolchain(local, need)
        verifyIssues = await verifyToolchain(resolved, config.ui.packageManager, need)
    }
    if (verifyIssues.length > 0) {
        if (options.write ?? true) writeLocalConfig(local, cwd)
        throw new Error([
            `${LOCAL_CONFIG_FILE} tool verification failed.`,
            ...verifyIssues.map(formatIssue),
            "Fix tool paths in arrange.local.yaml or install the missing components, then retry.",
        ].join("\n"))
    }
    if (options.write ?? true) writeLocalConfig(local, cwd)
    return resolved
}

export function normalizeLocalConfig(raw: unknown, path = LOCAL_CONFIG_FILE): LocalConfig {
    const object = expectRecord(raw, path)
    assertKnownKeys(object, path, ["platform", "windows", "macos"])
    const platform = expectString(object.platform, "platform")
    if (platform !== "windows" && platform !== "macos") throw new Error("platform must be windows or macos.")
    if (platform !== currentLocalPlatform()) throw new Error(`arrange.local.yaml platform is ${platform}, but this machine is ${currentLocalPlatform()}.`)

    const windows = object.windows === undefined ? undefined : normalizeWindows(optionalRecord(object.windows))
    const macos = object.macos === undefined ? undefined : normalizeMacos(optionalRecord(object.macos))
    if (platform === "windows" && !windows) throw new Error("arrange.local.yaml is missing the windows section.")
    if (platform === "macos" && !macos) throw new Error("arrange.local.yaml is missing the macos section.")
    return {platform, windows, macos}
}

export function stringifyLocalConfig(config: LocalConfig): string {
    return stringifyYaml(config)
}

function normalizeWindows(raw: Record<string, unknown>): WindowsLocalConfig {
    assertKnownKeys(raw, "windows", ["shell", "packageManager", "cmake", "msvc"])
    const shell = optionalRecord(raw.shell)
    const packageManager = expectRecord(raw.packageManager, "windows.packageManager")
    const cmake = raw.cmake === undefined ? undefined : normalizeCmake(optionalRecord(raw.cmake), "windows.cmake")
    const msvc = raw.msvc === undefined ? undefined : optionalRecord(raw.msvc)
    assertKnownKeys(shell, "windows.shell", ["command"])
    assertKnownKeys(packageManager, "windows.packageManager", ["command"])
    if (msvc) assertKnownKeys(msvc, "windows.msvc", ["devCmd", "arch", "hostArch"])
    return {
        shell: {command: shell.command === undefined ? "cmd.exe" : expectString(shell.command, "windows.shell.command")},
        packageManager: {command: expectString(packageManager.command, "windows.packageManager.command")},
        cmake,
        msvc: msvc ? {
            devCmd: expectString(msvc.devCmd, "windows.msvc.devCmd"),
            arch: msvc.arch === undefined ? "x64" : expectString(msvc.arch, "windows.msvc.arch"),
            hostArch: msvc.hostArch === undefined ? "x64" : expectString(msvc.hostArch, "windows.msvc.hostArch"),
        } : undefined,
    }
}

function normalizeMacos(raw: Record<string, unknown>): MacosLocalConfig {
    assertKnownKeys(raw, "macos", ["shell", "packageManager", "cmake"])
    const shell = optionalRecord(raw.shell)
    const packageManager = expectRecord(raw.packageManager, "macos.packageManager")
    assertKnownKeys(shell, "macos.shell", ["command"])
    assertKnownKeys(packageManager, "macos.packageManager", ["command"])
    return {
        shell: {command: shell.command === undefined ? "/bin/zsh" : expectString(shell.command, "macos.shell.command")},
        packageManager: {command: expectString(packageManager.command, "macos.packageManager.command")},
        cmake: raw.cmake === undefined ? undefined : normalizeCmake(optionalRecord(raw.cmake), "macos.cmake"),
    }
}

function normalizeCmake(raw: Record<string, unknown>, label: string): LocalCMakeConfig {
    assertKnownKeys(raw, label, ["command", "generator", "makeProgram", "configureArgs", "buildArgs"])
    return {
        command: expectString(raw.command, `${label}.command`),
        generator: expectString(raw.generator, `${label}.generator`),
        makeProgram: raw.makeProgram === undefined ? undefined : expectString(raw.makeProgram, `${label}.makeProgram`),
        configureArgs: raw.configureArgs === undefined ? [] : expectStringArray(raw.configureArgs, `${label}.configureArgs`),
        buildArgs: raw.buildArgs === undefined ? [] : expectStringArray(raw.buildArgs, `${label}.buildArgs`),
    }
}

function safeReadLocalConfig(cwd: string): LocalConfig | null {
    try {
        return readLocalConfig(cwd)
    } catch (error) {
        throw new Error(`${LOCAL_CONFIG_FILE} is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
}

function emptyLocalConfig(platform: LocalPlatform): LocalConfig {
    return platform === "windows" ? {platform, windows: {shell: {command: "cmd.exe"}, packageManager: {command: ""}}} : {platform, macos: {shell: {command: "/bin/zsh"}, packageManager: {command: ""}}}
}

function reconcileLocalConfig(local: LocalConfig, packageManager: PackageManager, need: ToolchainNeed): DiscoveryIssue[] {
    const issues: DiscoveryIssue[] = []
    const section = local.platform === "windows" ? local.windows : local.macos
    if (!section) return [{field: local.platform, message: "Current platform section is missing."}]

    const defaultShell = local.platform === "windows" ? "cmd.exe" : "/bin/zsh"
    if (!validExecutable(section.shell.command)) section.shell.command = defaultShell
    if (!validExecutable(section.shell.command)) {
        issues.push({field: `${local.platform}.shell.command`, message: "Shell for external commands was not found."})
    }

    if (!validExecutable(section.packageManager.command)) {
        const candidates = discoverPackageManagerCandidates(packageManager)
        section.packageManager.command = chooseDiscovered(`${local.platform}.packageManager.command`, `Multiple ${packageManager} executables were found; choose one.`, candidates, issues) ?? ""
    }
    if (!validExecutable(section.packageManager.command)) {
        if (!hasIssue(issues, `${local.platform}.packageManager.command`)) {
            issues.push({field: `${local.platform}.packageManager.command`, message: `${packageManager} executable was not found.`})
        }
    } else if (!packageManagerMatches(section.packageManager.command, packageManager)) {
        issues.push({field: `${local.platform}.packageManager.command`, message: `This project requires ${packageManager}, but local config points to ${section.packageManager.command}.`})
    }

    if (need.native) {
        section.cmake = reconcileCmake(section.cmake, local.platform, issues)
        if (!section.cmake.command && !hasIssue(issues, `${local.platform}.cmake.command`)) issues.push({field: `${local.platform}.cmake.command`, message: "CMake executable was not found."})
        if (!section.cmake.generator) issues.push({field: `${local.platform}.cmake.generator`, message: "CMake generator is missing."})
        if (section.cmake.makeProgram && !validExecutable(section.cmake.makeProgram) && !hasIssue(issues, `${local.platform}.cmake.makeProgram`)) issues.push({field: `${local.platform}.cmake.makeProgram`, message: "Build tool path does not exist."})
        if (generatorNeedsMakeProgram(section.cmake.generator) && !validExecutable(section.cmake.makeProgram) && !hasIssue(issues, `${local.platform}.cmake.makeProgram`)) issues.push({field: `${local.platform}.cmake.makeProgram`, message: `${section.cmake.generator} requires an explicit executable build tool path.`})
    }

    if (local.platform === "windows" && need.native) {
        const windows = section as WindowsLocalConfig
        if (!windows.msvc || !validExecutable(windows.msvc.devCmd)) {
            const candidates = discoverMsvcCandidates()
            const devCmd = chooseDiscovered("windows.msvc.devCmd", "Multiple Visual Studio Developer Command Prompt candidates were found; choose one.", candidates, issues)
            if (devCmd) windows.msvc = {devCmd, arch: "x64", hostArch: "x64"}
        }
        if ((!windows.msvc || !validExecutable(windows.msvc.devCmd)) && !hasIssue(issues, "windows.msvc.devCmd")) issues.push({field: "windows.msvc.devCmd", message: "Visual Studio Developer Command Prompt was not found."})
    }
    return issues
}

async function promptForLocalConfig(local: LocalConfig, packageManager: PackageManager, need: ToolchainNeed, issues: DiscoveryIssue[]): Promise<void> {
    const section = local.platform === "windows" ? local.windows : local.macos
    if (!section) return
    console.log(`${LOCAL_CONFIG_FILE} needs local toolchain settings:`)
    for (const issue of issues) console.log(`- ${issue.field}: ${issue.message}`)
    const rl = createInterface({input, output})
    try {
        const shellIssue = findIssue(issues, `${local.platform}.shell.command`)
        if (shellIssue) section.shell.command = await askExecutablePath(rl, `${local.platform}.shell.command`, section.shell.command, shellIssue.candidates)

        const packageManagerIssue = findIssue(issues, `${local.platform}.packageManager.command`)
        if (need.ui && packageManagerIssue) section.packageManager.command = await askExecutablePath(rl, `${local.platform}.packageManager.command (${packageManager})`, section.packageManager.command, packageManagerIssue.candidates)

        if (need.native) {
            section.cmake = section.cmake ?? {command: "", generator: "Ninja", configureArgs: [], buildArgs: []}
            const cmakeIssue = findIssue(issues, `${local.platform}.cmake.command`)
            if (cmakeIssue) section.cmake.command = await askExecutablePath(rl, `${local.platform}.cmake.command`, section.cmake.command, cmakeIssue.candidates)

            if (findIssue(issues, `${local.platform}.cmake.generator`)) section.cmake.generator = await askRequiredText(rl, `${local.platform}.cmake.generator`, section.cmake.generator)

            const makeProgramIssue = findIssue(issues, `${local.platform}.cmake.makeProgram`)
            if (makeProgramIssue || generatorNeedsMakeProgram(section.cmake.generator) && !validExecutable(section.cmake.makeProgram)) section.cmake.makeProgram = await askExecutablePath(rl, `${local.platform}.cmake.makeProgram`, section.cmake.makeProgram, makeProgramIssue?.candidates)

            if (local.platform === "windows") {
                const windows = section as WindowsLocalConfig
                windows.msvc = windows.msvc ?? {devCmd: "", arch: "x64", hostArch: "x64"}
                const msvcIssue = findIssue(issues, "windows.msvc") ?? findIssue(issues, "windows.msvc.devCmd")

                if (msvcIssue) windows.msvc.devCmd = await askExecutablePath(rl, "windows.msvc.devCmd", windows.msvc.devCmd, msvcIssue.candidates)
            }
        }
    } finally {
        rl.close()
    }
}

function findIssue(issues: DiscoveryIssue[], field: string): DiscoveryIssue | undefined {
    return issues.find((issue) => issue.field === field || issue.field.startsWith(`${field}.`) || field.startsWith(`${issue.field}.`))
}

function hasIssue(issues: DiscoveryIssue[], field: string): boolean {
    return findIssue(issues, field) !== undefined
}

async function askExecutablePath(rl: ReturnType<typeof createInterface>, label: string, current: string | undefined, candidates: string[] = []): Promise<string> {
    const uniqueCandidates = unique(candidates).filter(validExecutable)
    const defaultValue = validExecutable(current) ? current : undefined
    while (true) {
        if (uniqueCandidates.length > 0) {
            console.log(`${label} candidates:`)
            uniqueCandidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`))
        }
        const suffix = defaultValue ? ` (${defaultValue})` : ""
        const answer = (await rl.question(`${label}${suffix}: `)).trim()
        if (!answer && defaultValue) return defaultValue
        const selected = Number(answer)
        if (Number.isInteger(selected) && selected >= 1 && selected <= uniqueCandidates.length) return uniqueCandidates[selected - 1]
        if (answer && validExecutable(answer)) return answer
        console.log("Enter an existing executable path, or choose a candidate above.")
    }
}

async function askRequiredText(rl: ReturnType<typeof createInterface>, label: string, current: string | undefined): Promise<string> {
    const defaultValue = typeof current === "string" && current.length > 0 ? current : undefined
    while (true) {
        const suffix = defaultValue ? ` (${defaultValue})` : ""
        const answer = (await rl.question(`${label}${suffix}: `)).trim()
        if (answer) return answer
        if (defaultValue) return defaultValue
        console.log("Enter a non-empty value.")
    }
}

function shouldPrompt(options: EnsureToolchainOptions): boolean {
    return options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

function reconcileCmake(current: LocalCMakeConfig | undefined, platform: LocalPlatform, issues: DiscoveryIssue[]): LocalCMakeConfig {
    const commandCandidates = validExecutable(current?.command) ? [] : discoverCmakeCandidates()
    const command = validExecutable(current?.command) ? current.command : chooseDiscovered(`${platform}.cmake.command`, "Multiple CMake executables were found; choose one.", commandCandidates, issues) ?? ""
    const makeProgramCandidates = validExecutable(current?.makeProgram) ? [] : discoverNinjaCandidates()
    const makeProgram = validExecutable(current?.makeProgram) ? current.makeProgram : chooseDiscovered(`${platform}.cmake.makeProgram`, "Multiple Ninja executables were found; choose one.", makeProgramCandidates, issues)
    return {
        command,
        generator: current?.generator || (makeProgram ? "Ninja" : defaultGenerator()),
        makeProgram: makeProgram || current?.makeProgram,
        configureArgs: current?.configureArgs ?? [],
        buildArgs: current?.buildArgs ?? [],
    }
}

function chooseDiscovered(field: string, multipleMessage: string, candidates: string[], issues: DiscoveryIssue[]): string | undefined {
    const uniqueCandidates = unique(candidates)
    if (uniqueCandidates.length === 1) return uniqueCandidates[0]
    if (uniqueCandidates.length > 1) issues.push({field, message: multipleMessage, candidates: uniqueCandidates})
    return undefined
}

function generatorNeedsMakeProgram(generator: string | undefined): boolean {
    return typeof generator === "string" && /\bninja\b/i.test(generator)
}

function resolveToolchain(local: LocalConfig, need: ToolchainNeed): ResolvedToolchain {
    const section = local.platform === "windows" ? local.windows : local.macos
    if (!section) throw new Error(`${LOCAL_CONFIG_FILE} is missing the current platform section.`)
    return {
        platform: local.platform,
        shellCommand: section.shell.command,
        packageManagerCommand: need.ui ? section.packageManager.command : undefined,
        cmake: need.native ? section.cmake : undefined,
        msvc: local.platform === "windows" && need.native ? (section as WindowsLocalConfig).msvc : undefined,
    }
}

async function verifyToolchain(toolchain: ResolvedToolchain, packageManager: PackageManager, need: ToolchainNeed): Promise<DiscoveryIssue[]> {
    const issues: DiscoveryIssue[] = []
    if (toolchain.packageManagerCommand) await collectVerification(issues, `${toolchain.platform}.packageManager.command`, `${packageManager} --version`,
        () => runQuiet(toolchain.packageManagerCommand!, ["--version"], {toolchain, label: `${packageManager} --version`})
    )
    if (need.native) {
        if (!toolchain.cmake) issues.push({field: `${toolchain.platform}.cmake`, message: "CMake configuration is missing."})
        else {
            await collectVerification(issues, `${toolchain.platform}.cmake.command`, "CMake cannot run",
                () =>runQuiet(toolchain.cmake!.command, ["--version"], {toolchain, label: "cmake --version"})
            )
            if (toolchain.cmake.makeProgram) await collectVerification(issues, `${toolchain.platform}.cmake.makeProgram`, "Build tool cannot run",
                () => runQuiet(toolchain.cmake!.makeProgram!, ["--version"], {toolchain, label: "build tool --version"})
            )
        }

        if (toolchain.platform === "windows") await verifyMsvcDevCmd(issues, toolchain)
    }
    return issues
}

async function verifyMsvcDevCmd(issues: DiscoveryIssue[], toolchain: ResolvedToolchain): Promise<void> {
    const tools = ["cl", "link", "lib", "rc", "mt"]
    for (const tool of tools) await collectVerification(issues, "windows.msvc", `MSVC Developer Command Prompt does not provide ${tool}`,
        () => runQuiet("where", [tool], {toolchain, msvc: true, label: `where ${tool}`})
    )
}

async function collectVerification(issues: DiscoveryIssue[], field: string, prefix: string, action: () => Promise<void>): Promise<void> {
    try {
        await action()
    } catch (error) {
        issues.push({field, message: `${prefix}: ${error instanceof Error ? error.message : String(error)}`})
    }
}

export function currentLocalPlatform(): LocalPlatform {
    if (process.platform === "win32") return "windows"
    if (process.platform === "darwin") return "macos"
    throw new Error(`Arrange CLI currently supports only Windows and macOS; this platform is ${process.platform}.`)
}

function discoverPackageManagerCandidates(kind: PackageManager): string[] {
    return unique([
        ...findOnPathCandidates(process.platform === "win32" ? `${kind}.cmd` : kind),
        ...findOnPathCandidates(kind),
    ])
}

function packageManagerMatches(command: string, kind: PackageManager): boolean {
    const name = basename(command).toLowerCase()
    return kind === "pnpm" ? name.startsWith("pnpm") : name.startsWith("npm")
}

function discoverCmakeCandidates(): string[] {
    return unique([
        ...(process.env.CMAKE_EXE && validExecutable(process.env.CMAKE_EXE) ? [process.env.CMAKE_EXE] : []),
        ...findOnPathCandidates(process.platform === "win32" ? "cmake.exe" : "cmake"),
        ...discoverVisualStudioToolCandidates(["Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe"]),
    ])
}

function discoverNinjaCandidates(): string[] {
    return unique([
        ...findOnPathCandidates(process.platform === "win32" ? "ninja.exe" : "ninja"),
        ...discoverVisualStudioToolCandidates(["Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja", "ninja.exe"]),
    ])
}

function discoverMsvcCandidates(): string[] {
    return unique([
        ...discoverMsvcCandidatesByVswhere(),
        ...discoverVisualStudioToolCandidates(["Common7", "Tools", "VsDevCmd.bat"]),
    ])
}

function discoverMsvcCandidatesByVswhere(): string[] {
    if (process.platform !== "win32") return []
    const vswhere = discoverVswhere()
    if (!vswhere) return []
    const output = runCaptureSync(vswhere, [
        "-products", "*",
        "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-format", "json",
    ], {label: "vswhere"})
    if (!output) return []
    try {
        const entries = JSON.parse(output) as unknown
        if (!Array.isArray(entries)) return []
        return unique(entries
            .map((entry) => typeof entry === "object" && entry !== null && "installationPath" in entry ? (entry as {installationPath?: unknown}).installationPath : undefined)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .map((installationPath) => join(installationPath, "Common7", "Tools", "VsDevCmd.bat"))
            .filter(validExecutable))
    } catch {
        return []
    }
}

function discoverVswhere(): string | undefined {
    const candidates = [
        process.env.VSWHERE_EXE,
        process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"]!, "Microsoft Visual Studio", "Installer", "vswhere.exe") : undefined,
        process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe") : undefined,
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
    return candidates.find(validExecutable)
}

function discoverVisualStudioToolCandidates(parts: string[]): string[] {
    if (process.platform !== "win32") return []
    const roots = [
        process.env.VSINSTALLDIR,
        "C:/Program Files/Microsoft Visual Studio/2022/BuildTools",
        "C:/Program Files/Microsoft Visual Studio/2022/Community",
        "C:/Program Files/Microsoft Visual Studio/2022/Professional",
        "C:/Program Files/Microsoft Visual Studio/2022/Enterprise",
        "D:/Microsoft Visual Studio/18/BuildTools",
        "D:/Microsoft Visual Studio/2022/BuildTools",
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
    const candidates: string[] = []
    for (const root of roots) {
        const candidate = join(root, ...parts)
        if (validExecutable(candidate)) candidates.push(candidate)
    }
    return unique(candidates)
}

function findOnPathCandidates(command: string): string[] {
    if (isAbsolute(command) && validExecutable(command)) return [command]

    const pathEnv = process.env.PATH ?? ""
    const extensions = process.platform === "win32" && !/\.[^\\/]+$/.test(command) ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""]
    const candidates: string[] = []
    for (const dir of pathEnv.split(delimiter)) {
        if (!dir) continue
        for (const ext of extensions) {
            const candidate = resolve(dir, `${command}${ext}`)
            if (validExecutable(candidate)) candidates.push(candidate)
        }
    }

    return unique(candidates)
}

function validExecutable(path: string | undefined): path is string {
    if (!path) return false
    if (path === "cmd.exe" && process.platform === "win32") return true
    return existsSync(resolve(path)) || existsSync(path) || existsSync(resolve(dirname(path), path))
}

function defaultGenerator(): string {
    return process.platform === "win32" ? "Ninja" : "Ninja"
}

function unique(values: readonly string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of values) {
        const key = process.platform === "win32" ? value.toLowerCase() : value
        if (seen.has(key)) continue
        seen.add(key)
        result.push(value)
    }
    return result
}

function formatIssue(issue: DiscoveryIssue): string {
    const candidates = issue.candidates?.length ? ` candidates: ${issue.candidates.join("; ")}` : ""
    return `- ${issue.field}: ${issue.message}${candidates}`
}
