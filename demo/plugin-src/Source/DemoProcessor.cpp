#include "DemoProcessor.h"

#include <arrange/juce/ArrangeEditor.h>
#include <utility>

ArrangeDemoProcessor::ArrangeDemoProcessor() : juce::AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

void ArrangeDemoProcessor::prepareToPlay(double, int) {}

bool ArrangeDemoProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const { return layouts.getMainInputChannelSet() == layouts.getMainOutputChannelSet(); }

void ArrangeDemoProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    for (int channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel) buffer.clear(channel, 0, buffer.getNumSamples());
}

juce::AudioProcessorEditor* ArrangeDemoProcessor::createEditor() {
    arrange::juce::EditorConfig config;
    config.app.useDist("../ui");
    config.width = 520;
    config.height = 380;
    config.window.title = "Arrange Demo";
    config.window.resizable = true;
    config.window.useCornerResizer = true;
    config.window.minWidth = 420;
    config.window.minHeight = 300;
#if !defined(NDEBUG)
    config.app.useLive();
    config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Always;
#endif
    return new arrange::juce::ArrangeEditor(*this, std::move(config));
}

void ArrangeDemoProcessor::getStateInformation(juce::MemoryBlock&) {}
void ArrangeDemoProcessor::setStateInformation(const void*, int) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ArrangeDemoProcessor(); }
