import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, relative, resolve} from "node:path"
import type {ArrangeConfig, Flavor, Product} from "./config.ts"
import type {LocalCMakeConfig} from "./local.ts"

export type SyncScope = "all" | "ui" | "native"
export type SyncMode = "all" | "project" | "toolchain" | "check"

export function ensureProjectFiles(config: ArrangeConfig, root: string, options: {scope: SyncScope; check?: boolean; registry?: string}): string[] {
    const changes: string[] = []
    if (options.scope === "all" || options.scope === "ui") changes.push(...ensureUiProject(config, root, options.check ?? false, options.registry))
    if (options.scope === "all" || options.scope === "native") changes.push(...ensureNativeProject(config, root, options.check ?? false))
    return changes
}

export function ensureUiProject(config: ArrangeConfig, root: string, check: boolean, registry?: string): string[] {
    const uiDir = resolve(root, config.ui.path)
    const packagePath = resolve(uiDir, "package.json")
    const npmrcPath = resolve(uiDir, ".npmrc")
    const srcDir = resolve(uiDir, "src")
    const mainPath = resolve(srcDir, "main.ts")
    const appPath = resolve(srcDir, "App.vue")
    const changes: string[] = []
    const manifest = existsSync(packagePath)
        ? JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>
        : {name: packageName(config.project.name), private: true, type: "module"}
    const dependencies = asRecord(manifest.dependencies)
    if (dependencies["@arrange/framework"] !== config.arrange.version) {
        dependencies["@arrange/framework"] = config.arrange.version
        manifest.dependencies = dependencies
        changes.push(relative(root, packagePath))
    }
    if (!existsSync(packagePath)) changes.push(relative(root, packagePath))
    const npmrc = registry ? scopeRegistryNpmrc(registry) : null
    if (npmrc && (!existsSync(npmrcPath) || readFileSync(npmrcPath, "utf8") !== npmrc)) changes.push(relative(root, npmrcPath))
    if (!check) {
        mkdirSync(uiDir, {recursive: true})
        writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
        if (npmrc) writeFileSync(npmrcPath, npmrc)
        mkdirSync(srcDir, {recursive: true})
        if (!existsSync(mainPath)) {
            writeFileSync(mainPath, [
                `import { createApp } from "@arrange/framework"`,
                `import App from "./App.vue"`,
                "",
                "createApp(App).mount()",
                "",
            ].join("\n"))
            changes.push(relative(root, mainPath))
        }
        if (!existsSync(appPath)) {
            writeFileSync(appPath, [
                "<template>",
                "  <Column>",
                `    <Text text=\"${config.project.name}\" />`,
                "  </Column>",
                "</template>",
                "",
            ].join("\n"))
            changes.push(relative(root, appPath))
        }
    }
    return unique(changes)
}

function scopeRegistryNpmrc(registry: string): string {
    return `@arrange:registry=${registry.replace(/\/+$/, "")}\n`
}

export function ensureNativeProject(config: ArrangeConfig, root: string, check: boolean): string[] {
    const nativeDir = resolve(root, config.native.path)
    const cmakePath = resolve(nativeDir, "CMakeLists.txt")
    const sourceDir = resolve(nativeDir, "Source")
    const processorHeaderPath = resolve(sourceDir, `${config.project.name}Processor.h`)
    const processorPath = resolve(sourceDir, `${config.project.name}Processor.cpp`)
    const changes: string[] = []
    if (!existsSync(cmakePath)) {
        changes.push(relative(root, cmakePath))
        if (!check) {
            mkdirSync(nativeDir, {recursive: true})
            writeFileSync(cmakePath, createNativeCMake(config))
        }
    } else {
        const original = readFileSync(cmakePath, "utf8")
        try {
            const next = updateManagedRegions(original, config)
            if (next !== original) {
                changes.push(relative(root, cmakePath))
                if (!check) writeFileSync(cmakePath, next)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`${relative(root, cmakePath)} 受控区域损坏，已跳过该文件：${message}`)
            console.error("请修复对应的 # arrange:begin ... / # arrange:end ... 注释后重新运行 arrange sync。")
        }
    }
    if (!check) {
        mkdirSync(sourceDir, {recursive: true})
        if (!existsSync(processorHeaderPath)) {
            writeFileSync(processorHeaderPath, createProcessorHeader(config))
            changes.push(relative(root, processorHeaderPath))
        }
        if (!existsSync(processorPath)) {
            writeFileSync(processorPath, createProcessorSource(config))
            changes.push(relative(root, processorPath))
        }
    }
    return unique(changes)
}

function createNativeCMake(config: ArrangeConfig): string {
    return [
        "cmake_minimum_required(VERSION 3.24)",
        `project(${config.project.name} LANGUAGES C CXX)`,
        "",
        "set(CMAKE_CXX_STANDARD 20)",
        "set(CMAKE_CXX_STANDARD_REQUIRED ON)",
        "",
        managedRegion("fetchcontent", fetchContentRegion(config)),
        "",
        pluginBlock(config),
        "",
        managedRegion("link-framework", linkRegion(config)),
        "",
    ].join("\n")
}

function updateManagedRegions(source: string, config: ArrangeConfig): string {
    let next = replaceRegion(source, "fetchcontent", fetchContentRegion(config))
    next = replaceRegion(next, "link-framework", linkRegion(config))
    return next
}

function replaceRegion(source: string, name: string, body: string): string {
    const begin = `# arrange:begin ${name}`
    const end = `# arrange:end ${name}`
    const beginIndex = source.indexOf(begin)
    const endIndex = source.indexOf(end)
    if (beginIndex === -1 && endIndex === -1) return `${source.replace(/\s*$/, "\n\n")}${managedRegion(name, body)}\n`
    if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) throw new Error(`CMake managed region ${name} 损坏，请修复 ${begin} / ${end}。`)
    const endLine = source.indexOf("\n", endIndex)
    const after = endLine === -1 ? source.length : endLine + 1
    return `${source.slice(0, beginIndex)}${managedRegion(name, body)}\n${source.slice(after)}`
}

function managedRegion(name: string, body: string): string {
    return [`# arrange:begin ${name}`, body.trimEnd(), `# arrange:end ${name}`].join("\n")
}

function fetchContentRegion(config: ArrangeConfig): string {
    return [
        "include(FetchContent)",
        "FetchContent_Declare(arrange",
        "  GIT_REPOSITORY https://github.com/EarzuChan/Arrange.git",
        `  GIT_TAG v${config.arrange.version}`,
        ")",
        "FetchContent_MakeAvailable(arrange)",
    ].join("\n")
}

function linkRegion(config: ArrangeConfig): string {
    return [
        `target_link_libraries(${config.project.name} PRIVATE`,
        "  Arrange::framework",
        "  juce::juce_audio_utils",
        "  juce::juce_dsp",
        "  juce::juce_recommended_config_flags",
        "  juce::juce_recommended_lto_flags",
        "  juce::juce_recommended_warning_flags",
        ")",
    ].join("\n")
}

function pluginBlock(config: ArrangeConfig): string {
    const formats = config.project.products.map((product) => product === "standalone" ? "Standalone" : "VST3").join(" ")
    const isSynth = config.project.pluginType === "instrument" ? "TRUE" : "FALSE"
    return [
        `juce_add_plugin(${config.project.name}`,
        `  VERSION ${config.project.version}`,
        `  COMPANY_NAME "${config.project.companyName}"`,
        `  PLUGIN_MANUFACTURER_CODE ${config.project.companyCode}`,
        `  PLUGIN_CODE ${config.project.pluginCode}`,
        `  FORMATS ${formats}`,
        `  PRODUCT_NAME "${config.project.name}"`,
        `  IS_SYNTH ${isSynth}`,
        `  NEEDS_MIDI_INPUT ${isSynth}`,
        "  NEEDS_MIDI_OUTPUT FALSE",
        "  IS_MIDI_EFFECT FALSE",
        "  EDITOR_WANTS_KEYBOARD_FOCUS TRUE",
        "  COPY_PLUGIN_AFTER_BUILD FALSE",
        ")",
        `juce_generate_juce_header(${config.project.name})`,
        "",
        `target_sources(${config.project.name} PRIVATE`,
        `  Source/${config.project.name}Processor.cpp`,
        ")",
        "",
        `target_compile_definitions(${config.project.name} PRIVATE`,
        "  JUCE_WEB_BROWSER=0",
        "  JUCE_USE_CURL=0",
        ")",
        `target_compile_definitions(${config.project.name} PUBLIC`,
        "  JUCE_VST3_CAN_REPLACE_VST2=0",
        ")",
    ].join("\n")
}

function createProcessorSource(config: ArrangeConfig): string {
    const className = processorClassName(config)
    const pluginDisplayName = cppString(config.project.name)
    return [
        `#include "${config.project.name}Processor.h"`,
        "",
        "#include <arrange/juce/ArrangeEditor.h>",
        "#include <utility>",
        "",
        `${className}::${className}() : juce::AudioProcessor(BusesProperties()${config.project.pluginType === "instrument" ? "" : '.withInput("Input", juce::AudioChannelSet::stereo(), true)'}.withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}`,
        "",
        `void ${className}::prepareToPlay(double, int) {}`,
        "",
        `bool ${className}::isBusesLayoutSupported(const BusesLayout& layouts) const {`,
        "    if (layouts.getMainOutputChannelSet().isDisabled()) return false;",
        config.project.pluginType === "instrument"
            ? "    return true;"
            : "    return layouts.getMainInputChannelSet() == layouts.getMainOutputChannelSet();",
        "}",
        "",
        `void ${className}::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {`,
        "    juce::ScopedNoDenormals noDenormals;",
        "    for (int channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel) buffer.clear(channel, 0, buffer.getNumSamples());",
        "}",
        "",
        `juce::AudioProcessorEditor* ${className}::createEditor() {`,
        "    arrange::juce::EditorConfig config;",
        "    config.app.useDist();",
        "    config.width = 520;",
        "    config.height = 380;",
        `    config.window.title = ${pluginDisplayName};`,
        "    config.window.resizable = true;",
        "    config.window.useCornerResizer = true;",
        "    config.window.minWidth = 420;",
        "    config.window.minHeight = 300;",
        "#if !defined(NDEBUG)",
        "    config.app.useLive();",
        "    config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Always;",
        "#endif",
        "    return new arrange::juce::ArrangeEditor(*this, std::move(config));",
        "}",
        "",
        `void ${className}::getStateInformation(juce::MemoryBlock&) {}`,
        "",
        `void ${className}::setStateInformation(const void*, int) {}`,
        "",
        `juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ${className}(); }`,
        "",
    ].join("\n")
}

function createProcessorHeader(config: ArrangeConfig): string {
    const className = processorClassName(config)
    const isSynth = config.project.pluginType === "instrument"
    return [
        "#pragma once",
        "",
        "#include <JuceHeader.h>",
        "",
        `class ${className} final : public juce::AudioProcessor {`,
        "public:",
        `    ${className}();`,
        `    ~${className}() override = default;`,
        "",
        `    const juce::String getName() const override { return ${cppString(config.project.name)}; }`,
        `    bool acceptsMidi() const override { return ${isSynth ? "true" : "false"}; }`,
        "    bool producesMidi() const override { return false; }",
        "    bool isMidiEffect() const override { return false; }",
        "    double getTailLengthSeconds() const override { return 0.0; }",
        "",
        "    int getNumPrograms() override { return 1; }",
        "    int getCurrentProgram() override { return 0; }",
        "    void setCurrentProgram(int) override {}",
        "    const juce::String getProgramName(int) override { return {}; }",
        "    void changeProgramName(int, const juce::String&) override {}",
        "",
        "    void prepareToPlay(double sampleRate, int samplesPerBlock) override;",
        "    void releaseResources() override {}",
        "    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;",
        "    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override;",
        "",
        "    bool hasEditor() const override { return true; }",
        "    juce::AudioProcessorEditor* createEditor() override;",
        "",
        "    void getStateInformation(juce::MemoryBlock& destData) override;",
        "    void setStateInformation(const void* data, int sizeInBytes) override;",
        "",
        "private:",
        `    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(${className})`,
        "};",
        "",
    ].join("\n")
}

function processorClassName(config: ArrangeConfig): string {
    return `${config.project.name}Processor`
}

function cppString(value: string): string {
    return JSON.stringify(value)
}

export function cmakeBuildDir(config: ArrangeConfig, root: string, flavor: Flavor): string {
    return resolve(root, config.native.path, config.native.cmake.buildDir, flavor)
}

export function cmakeConfigureArgs(config: ArrangeConfig, root: string, flavor: Flavor, cmake: LocalCMakeConfig): string[] {
    const nativeDir = resolve(root, config.native.path)
    const buildDir = cmakeBuildDir(config, root, flavor)
    return [
        "-S", nativeDir,
        "-B", buildDir,
        "-G", cmake.generator,
        ...(cmake.makeProgram ? [`-DCMAKE_MAKE_PROGRAM=${cmake.makeProgram}`] : []),
        `-DCMAKE_BUILD_TYPE=${flavor === "debug" ? "Debug" : "Release"}`,
        ...cmake.configureArgs,
    ]
}

export function cmakeBuildArgs(config: ArrangeConfig, root: string, flavor: Flavor, cmake: LocalCMakeConfig): string[] {
    return ["--build", cmakeBuildDir(config, root, flavor), "--config", flavor === "debug" ? "Debug" : "Release", ...cmake.buildArgs]
}

export function productTargetName(config: ArrangeConfig, product: Product): string {
    return `${config.project.name}_${product === "standalone" ? "Standalone" : "VST3"}`
}

function packageName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "arrange-app"
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function unique(values: string[]): string[] {
    return [...new Set(values)]
}
