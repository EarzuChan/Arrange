import test from "node:test"
import assert from "node:assert/strict"
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, resolve} from "node:path"
import {defaultConfig, readProjectConfig, writeProjectConfig} from "../src/config.ts"
import {ensureProjectFiles} from "../src/project.ts"
import {normalizeViteArgs} from "../src/vite.ts"
import {main} from "../src/main.ts"
import {normalizeRegistryUrl, readInstalledFrameworkMetadata} from "../src/framework.ts"
import {readArrangeRegistryFromNpmrc} from "../src/package-resolve.ts"
import {currentLocalPlatform, ensureToolchain, readLocalConfig, stringifyLocalConfig, writeLocalConfig, type LocalConfig} from "../src/local.ts"
import {CLI_COMPATIBILITY} from "../src/constants.ts"

test("config yaml roundtrips with defaults and strict validation", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        writeProjectConfig(config, root)
        const read = readProjectConfig(root)
        assert.equal(read.arrange.version, config.arrange.version)
        assert.equal(read.project.name, config.project.name)
        assert.equal(read.native.cmake.buildDir, "build")
        assert.doesNotMatch(readFileSync(resolve(root, "arrange.config.yaml"), "utf8"), /generator|configureArgs|buildArgs/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("config rejects machine-local cmake fields", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        writeFileSync(resolve(root, "arrange.config.yaml"), [
            "arrange:",
            "  version: 0.0.0-m.2.2",
            "project:",
            "  name: MyPlugin",
            "  version: 0.1.0",
            "  companyName: Earzu",
            "  companyCode: Earz",
            "  pluginCode: Arng",
            "native:",
            "  cmake:",
            "    generator: Ninja",
            "",
        ].join("\n"))
        assert.throws(() => readProjectConfig(root), /native\.cmake: 未知字段 generator/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("local yaml roundtrips and is ignored by git", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const platform = currentLocalPlatform()
        const local: LocalConfig = platform === "windows"
            ? {
                platform,
                windows: {
                    shell: {command: "cmd.exe"},
                    packageManager: {command: process.execPath},
                    cmake: {command: process.execPath, generator: "Ninja", makeProgram: process.execPath, configureArgs: ["-DTEST=ON"], buildArgs: ["--verbose"]},
                    msvc: {devCmd: process.execPath, arch: "x64", hostArch: "x64"},
                },
            }
            : {
                platform,
                macos: {
                    shell: {command: "/bin/zsh"},
                    packageManager: {command: process.execPath},
                    cmake: {command: process.execPath, generator: "Ninja", makeProgram: process.execPath, configureArgs: ["-DTEST=ON"], buildArgs: ["--verbose"]},
                },
            }
        writeLocalConfig(local, root)
        const read = readLocalConfig(root)
        assert.equal(read?.platform, local.platform)
        if (platform === "windows") {
            assert.equal(read?.windows?.packageManager.command, process.execPath)
            assert.equal(read?.windows?.cmake?.configureArgs[0], "-DTEST=ON")
        } else {
            assert.equal(read?.macos?.packageManager.command, process.execPath)
            assert.equal(read?.macos?.cmake?.configureArgs[0], "-DTEST=ON")
        }
        assert.match(readFileSync(resolve(root, ".gitignore"), "utf8"), /^arrange\.local\.yaml$/m)
        assert.match(stringifyLocalConfig(local), /platform: /)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("toolchain uses arrange.local.yaml without accepting wrong package manager", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const platform = currentLocalPlatform()
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
            packageManager: "pnpm",
        })
        const toolDir = resolve(root, "tools")
        mkdirSync(toolDir, {recursive: true})
        const pnpm = resolve(toolDir, platform === "windows" ? "pnpm.cmd" : "pnpm")
        const npm = resolve(toolDir, platform === "windows" ? "npm.cmd" : "npm")
        const cmake = resolve(toolDir, platform === "windows" ? "cmake.cmd" : "cmake")
        const ninja = resolve(toolDir, platform === "windows" ? "ninja.cmd" : "ninja")
        const devCmd = resolve(toolDir, "VsDevCmd.bat")
        for (const path of [pnpm, npm, cmake, ninja]) writeTool(path, platform)
        if (platform === "windows") {
            writeFileSync(devCmd, `@echo off\r\nset PATH=${toolDir};%PATH%\r\nexit /b 0\r\n`)
            for (const tool of ["cl", "link", "lib", "rc", "mt"]) writeTool(resolve(toolDir, `${tool}.cmd`), platform)
        }
        writeLocalConfig(platform === "windows" ? {
            platform,
            windows: {
                shell: {command: "cmd.exe"},
                packageManager: {command: pnpm},
                cmake: {command: cmake, generator: "Ninja", makeProgram: ninja, configureArgs: [], buildArgs: []},
                msvc: {devCmd, arch: "x64", hostArch: "x64"},
            },
        } : {
            platform,
            macos: {
                shell: {command: "/bin/zsh"},
                packageManager: {command: pnpm},
                cmake: {command: cmake, generator: "Ninja", makeProgram: ninja, configureArgs: [], buildArgs: []},
            },
        }, root)
        const toolchain = await ensureToolchain(config, root, {ui: true, native: true})
        assert.equal(toolchain.packageManagerCommand, pnpm)
        assert.equal(toolchain.cmake?.command, cmake)

        const wrong = readLocalConfig(root)!
        if (platform === "windows") wrong.windows!.packageManager.command = npm
        else wrong.macos!.packageManager.command = npm
        writeLocalConfig(wrong, root)
        await assert.rejects(() => ensureToolchain(config, root, {ui: true}), /当前工程要求 pnpm/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("toolchain discovers missing local config and writes it after verification", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const oldPath = process.env.PATH
    try {
        const platform = currentLocalPlatform()
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
            packageManager: "pnpm",
        })
        const toolDir = resolve(root, "tools")
        mkdirSync(toolDir, {recursive: true})
        const pnpm = resolve(toolDir, platform === "windows" ? "pnpm.cmd" : "pnpm")
        writeTool(pnpm, platform)
        process.env.PATH = testPathWithOnlyToolDir(toolDir, platform)
        const toolchain = await ensureToolchain(config, root, {ui: true}, {interactive: false})
        assert.equal(toolchain.packageManagerCommand, pnpm)
        assert.equal(toolchain.cmake, undefined)
        const local = readLocalConfig(root)
        assert.equal(local?.platform, platform)
        assert.match(readFileSync(resolve(root, ".gitignore"), "utf8"), /^arrange\.local\.yaml$/m)
    } finally {
        process.env.PATH = oldPath
        rmSync(root, {recursive: true, force: true})
    }
})

test("toolchain preserves local config when deep verification fails", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const oldPath = process.env.PATH
    try {
        const platform = currentLocalPlatform()
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
            packageManager: "pnpm",
        })
        const toolDir = resolve(root, "tools")
        mkdirSync(toolDir, {recursive: true})
        const pnpm = resolve(toolDir, platform === "windows" ? "pnpm.cmd" : "pnpm")
        writeFailingTool(pnpm, platform)
        process.env.PATH = testPathWithOnlyToolDir(toolDir, platform)
        await assert.rejects(() => ensureToolchain(config, root, {ui: true}, {interactive: false}), /pnpm --version/)
        const local = readLocalConfig(root)
        assert.equal(platform === "windows" ? local?.windows?.packageManager.command : local?.macos?.packageManager.command, pnpm)
    } finally {
        process.env.PATH = oldPath
        rmSync(root, {recursive: true, force: true})
    }
})

test("toolchain refuses ambiguous discovered candidates without user choice", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const oldPath = process.env.PATH
    try {
        const platform = currentLocalPlatform()
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
            packageManager: "pnpm",
        })
        const first = resolve(root, "first")
        const second = resolve(root, "second")
        mkdirSync(first, {recursive: true})
        mkdirSync(second, {recursive: true})
        writeTool(resolve(first, platform === "windows" ? "pnpm.cmd" : "pnpm"), platform)
        writeTool(resolve(second, platform === "windows" ? "pnpm.cmd" : "pnpm"), platform)
        process.env.PATH = `${first}${platform === "windows" ? ";" : ":"}${second}${platform === "windows" ? ";" : ":"}${systemPathForTest(platform)}`
        await assert.rejects(() => ensureToolchain(config, root, {ui: true}, {interactive: false}), /找到多个 pnpm/)
    } finally {
        process.env.PATH = oldPath
        rmSync(root, {recursive: true, force: true})
    }
})

test("sync toolchain check verifies local toolchain without install", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const previous = process.cwd()
    try {
        const platform = currentLocalPlatform()
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
            packageManager: "pnpm",
        })
        writeProjectConfig(config, root)
        const frameworkDir = resolve(root, "ui/node_modules/@arrange/framework")
        mkdirSync(frameworkDir, {recursive: true})
        writeFileSync(resolve(frameworkDir, "package.json"), JSON.stringify({version: "0.0.0-m.2.2", arrange: {cliCompatibility: CLI_COMPATIBILITY}}))
        const toolDir = resolve(root, "tools")
        mkdirSync(toolDir, {recursive: true})
        const pnpm = resolve(toolDir, platform === "windows" ? "pnpm.cmd" : "pnpm")
        writeTool(pnpm, platform)
        writeLocalConfig(platform === "windows" ? {
            platform,
            windows: {shell: {command: "cmd.exe"}, packageManager: {command: pnpm}},
        } : {
            platform,
            macos: {shell: {command: "/bin/zsh"}, packageManager: {command: pnpm}},
        }, root)
        process.chdir(root)
        const result = await main(["sync", "--toolchain-only", "--ui", "--check"])
        assert.equal(result.exitCode, 0)
    } finally {
        process.chdir(previous)
        rmSync(root, {recursive: true, force: true})
    }
})

function writeTool(path: string, platform: ReturnType<typeof currentLocalPlatform>): void {
    if (platform === "windows") writeFileSync(path, "@echo off\r\nexit /b 0\r\n")
    else {
        writeFileSync(path, "#!/bin/sh\nexit 0\n")
        chmodSync(path, 0o755)
    }
}

function writeFailingTool(path: string, platform: ReturnType<typeof currentLocalPlatform>): void {
    if (platform === "windows") writeFileSync(path, "@echo off\r\nexit /b 1\r\n")
    else {
        writeFileSync(path, "#!/bin/sh\nexit 1\n")
        chmodSync(path, 0o755)
    }
}

function testPathWithOnlyToolDir(toolDir: string, platform: ReturnType<typeof currentLocalPlatform>): string {
    return `${toolDir}${platform === "windows" ? ";" : ":"}${systemPathForTest(platform)}`
}

function systemPathForTest(platform: ReturnType<typeof currentLocalPlatform>): string {
    if (platform === "windows") return dirname(process.env.ComSpec ?? "C:/Windows/System32/cmd.exe")
    return "/bin:/usr/bin"
}

test("project sync creates ui package and native managed regions", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        const changed = ensureProjectFiles(config, root, {scope: "all"})
        assert.ok(changed.includes("ui\\package.json") || changed.includes("ui/package.json"))
        const uiManifest = JSON.parse(readFileSync(resolve(root, "ui/package.json"), "utf8"))
        assert.equal(uiManifest.dependencies["@arrange/framework"], "0.0.0-m.2.2")
        const cmake = readFileSync(resolve(root, "native/CMakeLists.txt"), "utf8")
        assert.match(cmake, /# arrange:begin fetchcontent/)
        assert.match(cmake, /GIT_TAG v0\.0\.0-m\.2\.2/)
        assert.match(cmake, /Arrange::framework/)
        const header = readFileSync(resolve(root, "native/Source/MyPluginProcessor.h"), "utf8")
        assert.match(header, /class MyPluginProcessor final : public juce::AudioProcessor/)
        assert.match(header, /juce::AudioProcessorEditor\* createEditor\(\) override/)
        const source = readFileSync(resolve(root, "native/Source/MyPluginProcessor.cpp"), "utf8")
        assert.match(source, /#include "MyPluginProcessor\.h"/)
        assert.match(source, /#include <arrange\/juce\/ArrangeEditor\.h>/)
        assert.match(source, /config\.app\.useDist\(\)/)
        assert.match(source, /config\.app\.useLive\(\)/)
        assert.match(source, /new arrange::juce::ArrangeEditor\(\*this, std::move\(config\)\)/)
        assert.match(source, /createPluginFilter\(\)/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("project sync writes scoped registry npmrc when registry is explicit", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        const changed = ensureProjectFiles(config, root, {scope: "ui", registry: "http://localhost:4873/"})
        assert.ok(changed.includes("ui\\.npmrc") || changed.includes("ui/.npmrc"))
        assert.equal(readFileSync(resolve(root, "ui/.npmrc"), "utf8"), "@arrange:registry=http://localhost:4873\n")
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("framework registry URL is normalized", () => {
    assert.equal(normalizeRegistryUrl("http://localhost:4873/"), "http://localhost:4873")
})

test("existing project commands can reuse scoped registry from ui npmrc", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        mkdirSync(resolve(root, "ui"), {recursive: true})
        writeFileSync(resolve(root, "ui/.npmrc"), "@arrange:registry=http://localhost:4873\n")
        assert.equal(readArrangeRegistryFromNpmrc(resolve(root, "ui")), "http://localhost:4873")
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("project sync skips damaged CMake managed regions instead of overwriting them", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        const cmakePath = resolve(root, "native/CMakeLists.txt")
        mkdirSync(resolve(root, "native"), {recursive: true})
        writeFileSync(cmakePath, "# arrange:begin fetchcontent\nbroken\n")
        const changed = ensureProjectFiles(config, root, {scope: "native"})
        assert.ok(changed.includes("native\\Source\\MyPluginProcessor.cpp") || changed.includes("native/Source/MyPluginProcessor.cpp"))
        assert.equal(readFileSync(cmakePath, "utf8"), "# arrange:begin fetchcontent\nbroken\n")
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("vite args inject Arrange Vite config", () => {
    const devArgs = normalizeViteArgs("dev")
    assert.deepEqual(devArgs.slice(0, 5), ["--host", "127.0.0.1", "--port", "9178", "--strictPort"])
    assert.ok(devArgs.includes("--config"))
    const devConfigPath = devArgs[devArgs.indexOf("--config") + 1]
    const devConfig = readFileSync(devConfigPath, "utf8")
    assert.match(devConfig, /arrangeViteApiRoot/)
    assert.match(devConfig, /plugins: \[arrange\(\)\]/)
    const buildArgs = normalizeViteArgs("build", ["--outDir", "dist"])
    assert.equal(buildArgs[0], "build")
    assert.ok(buildArgs.includes("--config"))
    assert.ok(buildArgs.includes("--outDir"))
})

test("missing installed framework metadata is not silently treated as compatible", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        assert.equal(readInstalledFrameworkMetadata(root, "ui"), null)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("existing project commands require config in current directory", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const previous = process.cwd()
    try {
        process.chdir(root)
        const result = await main(["sync", "--check"])
        assert.equal(result.exitCode, 1)
    } finally {
        process.chdir(previous)
        rmSync(root, {recursive: true, force: true})
    }
})

test("CLI rejects stale pseudo CLI flags instead of silently ignoring them", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    const previous = process.cwd()
    try {
        process.chdir(root)
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.2",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        writeProjectConfig(config, root)
        const result = await main(["build", "--outDir", "dist"])
        assert.equal(result.exitCode, 1)
    } finally {
        process.chdir(previous)
        rmSync(root, {recursive: true, force: true})
    }
})

test("build rejects meaningless clean combinations", async () => {
    const result = await main(["build", "--ui-only", "--clean"])
    assert.equal(result.exitCode, 1)
})

test("invalid config reports unknown top-level field", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        writeFileSync(resolve(root, "arrange.config.yaml"), "bad: true\n")
        assert.throws(() => readProjectConfig(root), /未知顶层字段 bad/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("invalid config reports unknown nested field", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        writeFileSync(resolve(root, "arrange.config.yaml"), [
            "arrange:",
            "  version: 0.0.0-m.2.2",
            "",
            "project:",
            "  name: MyPlugin",
            "  version: 0.1.0",
            "  companyName: Earzu",
            "  companyCode: Earz",
            "  pluginCode: Arng",
            "  surprise: nope",
            "",
        ].join("\n"))
        assert.throws(() => readProjectConfig(root), /project: 未知字段 surprise/)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})
