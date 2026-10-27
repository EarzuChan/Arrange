#pragma once

#include <JuceHeader.h>
#include <arrange/juce/Interop.h>

#include <array>
#include <map>

class ArrangeDemoProcessor final : public juce::AudioProcessor {
   public:
    ArrangeDemoProcessor();
    ~ArrangeDemoProcessor() override = default;

    const juce::String getName() const override {
        return "Arrange Demo";
    }

    bool acceptsMidi() const override {
        return false;
    }

    bool producesMidi() const override {
        return false;
    }

    bool isMidiEffect() const override {
        return false;
    }

    double getTailLengthSeconds() const override {
        return 0.0;
    }

    int getNumPrograms() override {
        return 1;
    }

    int getCurrentProgram() override {
        return 0;
    }

    void setCurrentProgram(int) override {}

    const juce::String getProgramName(int) override {
        return {};
    }

    void changeProgramName(int, const juce::String&) override {}

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;

    void releaseResources() override {}

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override;

    bool hasEditor() const override {
        return true;
    }

    juce::AudioProcessorEditor* createEditor() override;

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

   private:
    static constexpr int fftOrder = 10;
    static constexpr int fftSize = 1 << fftOrder;
    static constexpr int spectrumBins = 48;

    static juce::AudioProcessorValueTreeState::ParameterLayout createParameters();
    void registerInteropHandlers();
    void loadPreset(const juce::String& name);
    void analyse(const float* samples, int count) noexcept;

    juce::AudioProcessorValueTreeState state_;
    arrange::juce::Interop interop_{*this};
    arrange::juce::Meter& outputMeter_ = interop_.meter("output");
    arrange::juce::Waveform& outputWaveform_ = interop_.waveform("output", 8192);
    arrange::juce::Spectrum& outputSpectrum_ = interop_.spectrum("output", spectrumBins);

    std::atomic<float>* gain_ = nullptr;
    std::atomic<float>* mode_ = nullptr;
    std::atomic<float>* bypass_ = nullptr;
    juce::SmoothedValue<float> smoothedGain_;
    juce::AudioBuffer<float> mono_;
    juce::dsp::FFT fft_{fftOrder};
    juce::dsp::WindowingFunction<float> window_{static_cast<std::size_t>(fftSize), juce::dsp::WindowingFunction<float>::hann};
    std::array<float, fftSize> fifo_{};
    std::array<float, fftSize * 2> fftData_{};
    std::array<float, spectrumBins> bins_{};
    int fifoIndex_ = 0;
    std::map<juce::String, juce::ValueTree> presets_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ArrangeDemoProcessor);
};
