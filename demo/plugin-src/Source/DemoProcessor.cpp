#include "DemoProcessor.h"

#include <arrange/juce/ArrangeEditor.h>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace {
    const juce::String gainId = "gain";
    const juce::String modeId = "mode";
    const juce::String bypassId = "bypass";
    constexpr float minimumDecibels = -72.0f;
}

ArrangeDemoProcessor::ArrangeDemoProcessor() : juce::AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)), state_(*this, nullptr, "ArrangeDemo", createParameters()) {
    gain_ = state_.getRawParameterValue(gainId);
    mode_ = state_.getRawParameterValue(modeId);
    bypass_ = state_.getRawParameterValue(bypassId);
    // 参数在成员初始化时已全部登记；Interop 在此之后构造才能看到它们
    registerInteropHandlers();
}

juce::AudioProcessorValueTreeState::ParameterLayout ArrangeDemoProcessor::createParameters() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID(gainId, 1), "Gain", juce::NormalisableRange<float>(-48.0f, 12.0f, 0.1f), 0.0f, juce::AudioParameterFloatAttributes().withLabel("dB").withStringFromValueFunction([](float value, int) { return juce::String(value, 1) + " dB"; })));
    layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID(modeId, 1), "Mode", juce::StringArray{"Clean", "Soft Clip", "Hard Clip"}, 0));
    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID(bypassId, 1), "Bypass", false));
    return layout;
}

void ArrangeDemoProcessor::registerInteropHandlers() {
    const auto capture = [this] { return state_.copyState(); };
    presets_["Default"] = capture();
    interop_.handle("presets", [this](const arrange::juce::InteropValue&) {
        arrange::juce::InteropValue::Array names;
        names.emplace_back("Default");
        names.emplace_back("Hot");
        names.emplace_back("Crushed");
        for (const auto& [name, _] : presets_)
            if (name != "Default") names.emplace_back(name.toStdString());
        return arrange::juce::InteropValue::array(std::move(names));
    });
    interop_.handle("loadPreset", [this](const arrange::juce::InteropValue& args) {
        loadPreset(juce::String::fromUTF8(args.asString().c_str()));
        return arrange::juce::InteropValue{};
    });
    interop_.handle("savePreset", [this, capture](const arrange::juce::InteropValue& args) {
        const auto name = juce::String::fromUTF8(args.asString().c_str()).trim();
        if (name.isEmpty()) throw std::invalid_argument("预设名不能为空");
        presets_[name] = capture();
        return arrange::juce::InteropValue(name.toStdString());
    });
}

void ArrangeDemoProcessor::loadPreset(const juce::String& name) {
    const auto apply = [this](const juce::String& id, float plain) {
        auto* parameter = state_.getParameter(id);
        parameter->beginChangeGesture();
        parameter->setValueNotifyingHost(parameter->convertTo0to1(plain));
        parameter->endChangeGesture();
    };
    if (name == "Hot") {
        apply(gainId, 9.0f);
        apply(modeId, 1.0f);
        apply(bypassId, 0.0f);
    } else if (name == "Crushed") {
        apply(gainId, 12.0f);
        apply(modeId, 2.0f);
        apply(bypassId, 0.0f);
    } else {
        const auto found = presets_.find(name);
        if (found == presets_.end()) throw std::invalid_argument("未知预设：" + name.toStdString());
        state_.replaceState(found->second.createCopy());
    }
    interop_.emit("presetLoaded", arrange::juce::InteropValue::object({{"name", name.toStdString()}}));
}

void ArrangeDemoProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    interop_.prepare(sampleRate, samplesPerBlock);
    smoothedGain_.reset(sampleRate, 0.03);
    smoothedGain_.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(gain_->load()));
    mono_.setSize(1, samplesPerBlock);
    fifoIndex_ = 0;
}

bool ArrangeDemoProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet() == layouts.getMainOutputChannelSet();
}

void ArrangeDemoProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    interop_.process(getPlayHead());
    const auto samples = buffer.getNumSamples();
    const auto channels = getTotalNumInputChannels();
    for (int channel = channels; channel < getTotalNumOutputChannels(); ++channel) buffer.clear(channel, 0, samples);

    if (bypass_->load() < 0.5f) {
        smoothedGain_.setTargetValue(juce::Decibels::decibelsToGain(gain_->load()));
        const auto mode = static_cast<int>(mode_->load());
        for (int i = 0; i < samples; ++i) {
            const auto gain = smoothedGain_.getNextValue();
            for (int channel = 0; channel < channels; ++channel) {
                auto& sample = buffer.getWritePointer(channel)[i];
                sample *= gain;
                if (mode == 1) sample = std::tanh(sample);
                else if (mode == 2) sample = juce::jlimit(-1.0f, 1.0f, sample);
            }
        }
    }

    if (channels == 0 || samples > mono_.getNumSamples()) return;
    outputMeter_.push(buffer.getMagnitude(0, samples));
    auto* mono = mono_.getWritePointer(0);
    juce::FloatVectorOperations::copy(mono, buffer.getReadPointer(0), samples);
    for (int channel = 1; channel < channels; ++channel) juce::FloatVectorOperations::add(mono, buffer.getReadPointer(channel), samples);
    juce::FloatVectorOperations::multiply(mono, 1.0f / static_cast<float>(channels), samples);
    outputWaveform_.push(mono, static_cast<std::size_t>(samples));
    analyse(mono, samples);
}

void ArrangeDemoProcessor::analyse(const float* samples, int count) noexcept {
    for (int i = 0; i < count; ++i) {
        fifo_[static_cast<std::size_t>(fifoIndex_++)] = samples[i];
        if (fifoIndex_ < fftSize) continue;
        fifoIndex_ = 0;
        std::fill(fftData_.begin(), fftData_.end(), 0.0f);
        std::copy(fifo_.begin(), fifo_.end(), fftData_.begin());
        window_.multiplyWithWindowingTable(fftData_.data(), static_cast<std::size_t>(fftSize));
        fft_.performFrequencyOnlyForwardTransform(fftData_.data());
        // 对数频率分组，幅度换算为 0..1 的显示值
        for (int bin = 0; bin < spectrumBins; ++bin) {
            const auto from = static_cast<int>(std::pow(fftSize / 2.0, static_cast<double>(bin) / spectrumBins));
            const auto to = std::max(from + 1, static_cast<int>(std::pow(fftSize / 2.0, static_cast<double>(bin + 1) / spectrumBins)));
            float peak = 0.0f;
            for (int index = from; index < to && index < fftSize / 2; ++index) peak = std::max(peak, fftData_[static_cast<std::size_t>(index)]);
            const auto decibels = juce::Decibels::gainToDecibels(peak / (fftSize / 4.0f), minimumDecibels);
            bins_[static_cast<std::size_t>(bin)] = juce::jmap(decibels, minimumDecibels, 0.0f, 0.0f, 1.0f);
        }
        outputSpectrum_.publish(bins_.data(), bins_.size());
    }
}

juce::AudioProcessorEditor* ArrangeDemoProcessor::createEditor() {
    arrange::juce::EditorConfig config;

    config.app.useDist();
    config.width = 900;
    config.height = 780;
    config.window.title = "Arrange 原生画廊";
    config.window.resizable = true;
    config.window.useCornerResizer = true;
    config.window.minWidth = 420;
    config.window.minHeight = 300;
    config.interop = &interop_;
#if !defined(NDEBUG)
    config.app.useLive();
    config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Always;
#endif

    return new arrange::juce::ArrangeEditor(*this, std::move(config));
}

void ArrangeDemoProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (const auto xml = state_.copyState().createXml()) copyXmlToBinary(*xml, destData);
}

void ArrangeDemoProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (const auto xml = getXmlFromBinary(data, sizeInBytes); xml && xml->hasTagName(state_.state.getType())) state_.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new ArrangeDemoProcessor();
}
