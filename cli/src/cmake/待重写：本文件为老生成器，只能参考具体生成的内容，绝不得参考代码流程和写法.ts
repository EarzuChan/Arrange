import { relative, resolve } from "node:path"
import { writeTextFile } from "../utils/utils.ts"
import { cmakeManagedItemKeys } from "./CmakeManagedItems.ts"
import {isManagedItem, type ProjectState} from "../project/ProjectState.ts"
import type {PluginType} from "../project/CreateProject.ts"

const defaultCmakeFetchContentUrl = "https://github.com/EarzuChan/Arrange.git"

// 一次性的参数
export interface CmakeProjectGeneratorOptions {
    readonly pluginType: PluginType
}

export class CmakeProjectGenerator {
    async generate(rootDir: string, state: ProjectState, options: CmakeProjectGeneratorOptions): Promise<string[]> {
        const nativeDir = resolve(rootDir, state.project.native.directory)
        const sourceDir = resolve(nativeDir, "Source")
        const cmakePath = resolve(nativeDir, "CMakeLists.txt")
        const processorHeaderPath = resolve(sourceDir, `${state.project.project.name}Processor.h`)
        const processorSourcePath = resolve(sourceDir, `${state.project.project.name}Processor.cpp`)

        const files = [
            { path: cmakePath, content: createCmakeLists(state, options.pluginType) },
            { path: processorHeaderPath, content: createProcessorHeader(state, options.pluginType) },
            { path: processorSourcePath, content: createProcessorSource(state, options.pluginType) },
        ]

        const written: string[] = []
        for (const file of files) {
            await writeTextFile(file.path, file.content)
            written.push(relative(rootDir, file.path))
        }

        return written
    }
}

function createCmakeLists(state: ProjectState, pluginType: PluginType): string {
    return [
        "cmake_minimum_required(VERSION 3.24)",
        `project(${state.project.project.name} LANGUAGES C CXX)`,
        "",
        "set(CMAKE_CXX_STANDARD 20)",
        "set(CMAKE_CXX_STANDARD_REQUIRED ON)",
        "",
        createMaybeManagedBlock(state, cmakeManagedItemKeys.fetchContent, "fetchcontent", createFetchContentBlock(state)),
        "",
        createMaybeManagedBlock(state, cmakeManagedItemKeys.pluginTarget, "plugin-target", createPluginTargetBlock(state, pluginType)),
        "",
        createMaybeManagedBlock(state, cmakeManagedItemKeys.linkFramework, "link-framework", createLinkFrameworkBlock(state)),
        "",
    ].join("\n")
}

function createMaybeManagedBlock(state: ProjectState, key: string, regionName: string, body: string): string {
    return !isManagedItem(state, key) ? body : managedRegion(regionName, body)
}

function createFetchContentBlock(state: ProjectState): string {
    return [
        "include(FetchContent)",
        "FetchContent_Declare(arrange",
        `  GIT_REPOSITORY ${state.project.framework.cmakeFetchContentUrl ?? defaultCmakeFetchContentUrl}`,
        `  GIT_TAG v${state.project.framework.version}`,
        ")",
        "FetchContent_MakeAvailable(arrange)",
    ].join("\n")
}

function createPluginTargetBlock(state: ProjectState, pluginType: PluginType): string {
    const formats = state.project.project.products.map((product) => product === "standalone" ? "Standalone" : "VST3").join(" ")
    const isSynth = pluginType === "instrument" ? "TRUE" : "FALSE"

    return [
        `juce_add_plugin(${state.project.project.name}`,
        `  VERSION ${state.project.project.version}`,
        `  COMPANY_NAME "${state.project.project.vendorName}"`,
        `  PLUGIN_MANUFACTURER_CODE ${state.project.project.vendorCode}`,
        `  PLUGIN_CODE ${state.project.project.pluginCode}`,
        `  FORMATS ${formats}`,
        `  PRODUCT_NAME "${state.project.project.name}"`,
        `  IS_SYNTH ${isSynth}`,
        `  NEEDS_MIDI_INPUT ${isSynth}`,
        "  NEEDS_MIDI_OUTPUT FALSE",
        "  IS_MIDI_EFFECT FALSE",
        "  EDITOR_WANTS_KEYBOARD_FOCUS TRUE",
        "  COPY_PLUGIN_AFTER_BUILD FALSE",
        ")",
        `juce_generate_juce_header(${state.project.project.name})`,
        "",
        `target_sources(${state.project.project.name} PRIVATE`,
        `  Source/${state.project.project.name}Processor.cpp`,
        ")",
        "",
        `target_compile_definitions(${state.project.project.name} PRIVATE`,
        "  JUCE_WEB_BROWSER=0",
        "  JUCE_USE_CURL=0",
        ")",
        `target_compile_definitions(${state.project.project.name} PUBLIC`,
        "  JUCE_VST3_CAN_REPLACE_VST2=0",
        ")",
    ].join("\n")
}

function createLinkFrameworkBlock(state: ProjectState): string {
    return [
        `target_link_libraries(${state.project.project.name} PRIVATE`,
        "  Arrange::framework",
        "  juce::juce_audio_utils",
        "  juce::juce_dsp",
        "  juce::juce_recommended_config_flags",
        "  juce::juce_recommended_lto_flags",
        "  juce::juce_recommended_warning_flags",
        ")",
    ].join("\n")
}

function createProcessorHeader(state: ProjectState, pluginType: PluginType): string {
    const className = `${state.project.project.name}Processor`
    const isSynth = pluginType === "instrument"

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
        `    const juce::String getName() const override { return ${cppString(state.project.project.name)}; }`,
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

function createProcessorSource(state: ProjectState, pluginType: PluginType): string {
    const className = `${state.project.project.name}Processor`
    const inputBus = pluginType === "instrument" ? "" : '.withInput("Input", juce::AudioChannelSet::stereo(), true)'

    return [
        `#include "${state.project.project.name}Processor.h"`,
        "",
        "#include <arrange/juce/ArrangeEditor.h>",
        "#include <utility>",
        "",
        `${className}::${className}() : juce::AudioProcessor(BusesProperties()${inputBus}.withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}`,
        "",
        `void ${className}::prepareToPlay(double, int) {}`,
        "",
        `bool ${className}::isBusesLayoutSupported(const BusesLayout& layouts) const {`,
        "    if (layouts.getMainOutputChannelSet().isDisabled()) return false;",
        pluginType === "instrument"
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
        `    config.window.title = ${cppString(state.project.project.name)};`,
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

// CHECK：这个可能要被NPMRC复用
function managedRegion(name: string, body: string): string {
    return [`# arrange:begin ${name}`, body.trimEnd(), `# arrange:end ${name}`].join("\n")
}

function cppString(value: string): string {
    return JSON.stringify(value)
}
