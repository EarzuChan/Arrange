import test from "node:test"
import assert from "node:assert/strict"
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {defaultConfig, readProjectConfig, writeProjectConfig} from "../src/config.ts"
import {ensureProjectFiles} from "../src/project.ts"
import {normalizeViteArgs} from "../src/vite.ts"
import {main} from "../src/main.ts"
import {normalizeRegistryUrl, readInstalledFrameworkMetadata} from "../src/framework.ts"
import {readArrangeRegistryFromNpmrc} from "../src/package-resolve.ts"

test("config yaml roundtrips with defaults and strict validation", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.1",
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
        assert.equal(read.native.cmake.generator, undefined)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
})

test("project sync creates ui package and native managed regions", () => {
    const root = mkdtempSync(resolve(tmpdir(), "arrange-cli-"))
    try {
        const config = defaultConfig({
            frameworkVersion: "0.0.0-m.2.1",
            projectName: "MyPlugin",
            projectVersion: "0.1.0",
            companyName: "Earzu",
            companyCode: "Earz",
            pluginCode: "Arng",
        })
        const changed = ensureProjectFiles(config, root, {scope: "all"})
        assert.ok(changed.includes("ui\\package.json") || changed.includes("ui/package.json"))
        const uiManifest = JSON.parse(readFileSync(resolve(root, "ui/package.json"), "utf8"))
        assert.equal(uiManifest.dependencies["@arrange/framework"], "0.0.0-m.2.1")
        const cmake = readFileSync(resolve(root, "native/CMakeLists.txt"), "utf8")
        assert.match(cmake, /# arrange:begin fetchcontent/)
        assert.match(cmake, /GIT_TAG v0\.0\.0-m\.2\.1/)
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
            frameworkVersion: "0.0.0-m.2.1",
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
            frameworkVersion: "0.0.0-m.2.1",
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
            frameworkVersion: "0.0.0-m.2.1",
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
            "  version: 0.0.0-m.2.1",
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
