import { resolve } from "node:path"
import { defaultUiOutputDirectory } from "../CliMetadata.ts"
import type { ProjectState } from "./ProjectState.ts"
import { effectiveDisplayName } from "./ProjectMetadata.ts"

export interface InitialFile {
    readonly path: string
    readonly content: string
}

export function uiStarterFiles(state: ProjectState): InitialFile[] {
    const root = resolve(state.rootDir, state.project.ui.directory)
    const outputDirectory = state.project.ui.outputDirectory ?? defaultUiOutputDirectory
    return [
        {
            path: resolve(root, "src/main.ts"), content: `import { createApp } from '@arrange/framework'
import App from './App.sfa'

createApp(App).mount()
` },
        {
            path: resolve(root, "src/App.sfa"), content: `<template>
    <Column :modifier="M.fillMaxSize().background(Color(0xff17212e)).padding(24.dp)" :vertical-arrangement="Arrangement.spacedBy(16.dp)">
        <Text :text="projectTitle" :style="{ fontSize: 28.sp, color: Color(0xfff4f6fa) }"/>

        <Text :text="'点击次数：' + count" :modifier="M.clickable(increment).padding(12.dp).background(Color(0xff336699))" :style="{ fontSize: 18.sp, color: Color(0xffffffff) }"/>
    </Column>
</template>

<script>
import { ref } from '@arrange/framework'
import { Column, Text } from '@arrange/framework/foundation'
import { Arrangement, Color, M } from '@arrange/framework/ui'

const projectTitle = ${JSON.stringify(effectiveDisplayName(state))}
const count = ref(0)

function increment() {
    count.value += 1
}
</script>
` },
        {
            path: resolve(root, "vite.config.ts"), content: `import { defineConfig } from 'vite'
import arrange from '@arrange/framework/vite'

export default defineConfig({
    plugins: [arrange()],
    build: { outDir: ${JSON.stringify(outputDirectory)} },
})
` },
        { path: resolve(root, "tsconfig.json"), content: `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, allowArbitraryExtensions: true, noEmit: true, skipLibCheck: true, strict: true, lib: ["ES2022", "DOM"], types: ["vite/client", "node"] }, include: ["src/**/*.ts", "src/**/*.sfa"] }, null, 4)}\n` },
        {
            path: resolve(root, "scripts/check-types.ts"), content: `import { fileURLToPath } from 'node:url'
import { checkSfaProject } from '@arrange/framework/vite'

const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))
const diagnostics = checkSfaProject(configPath, [sourceRoot])
for (const diagnostic of diagnostics) console.error('[ArrangeTypecheck]', \`\${diagnostic.file}:\${diagnostic.line}:\${diagnostic.column} \${diagnostic.code}：\${diagnostic.message}\`)
if (diagnostics.length) process.exitCode = 1
else console.log('[ArrangeTypecheck]', 'SFA 脚本与模板类型检查通过')
` },
    ]
}

export function nativeStarterFiles(state: ProjectState): InitialFile[] {
    const root = resolve(state.rootDir, state.project.native.directory, "Source")
    const target = state.project.native.target
    const instrument = state.project.native.pluginType === "instrument"
    return [
        {
            path: resolve(root, `${target}Processor.h`), content: `#pragma once

#include <JuceHeader.h>

class PluginProcessor final : public juce::AudioProcessor {
   public:
    PluginProcessor();
    ~PluginProcessor() override = default;

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return ${instrument}; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void prepareToPlay(double, int) override {}
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override;
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;
    void getStateInformation(juce::MemoryBlock& destData) override { destData.reset(); }
    void setStateInformation(const void*, int) override {}

   private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginProcessor)
};
` },
        {
            path: resolve(root, `${target}Processor.cpp`), content: `#include "${target}Processor.h"

#include <arrange/juce/ArrangeEditor.h>
#include <utility>

PluginProcessor::PluginProcessor()
    : juce::AudioProcessor(BusesProperties()${instrument ? "" : '.withInput("Input", juce::AudioChannelSet::stereo(), true)'}.withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

bool PluginProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto output = layouts.getMainOutputChannelSet();
    if (output != juce::AudioChannelSet::mono() && output != juce::AudioChannelSet::stereo()) return false;
    return ${instrument ? "layouts.getMainInputChannelSet().isDisabled()" : "layouts.getMainInputChannelSet() == output"};
}

void PluginProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    ${instrument ? "buffer.clear();" : "for (int channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel) buffer.clear(channel, 0, buffer.getNumSamples());"}
}

juce::AudioProcessorEditor* PluginProcessor::createEditor() {
    arrange::juce::EditorConfig config;
    config.app.useDist();
#if !defined(NDEBUG)
    config.app.useLive();
#endif
    config.width = 640;
    config.height = 400;
    config.window.title = JucePlugin_Name;
    config.window.resizable = true;
    config.window.useCornerResizer = true;
    config.window.minWidth = 360;
    config.window.minHeight = 240;
    return new arrange::juce::ArrangeEditor(*this, std::move(config));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new PluginProcessor();
}
` },
    ]
}
