#pragma once

#include <arrange/core/Interop.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_audio_processors/juce_audio_processors.h>
#endif

namespace arrange::juce {
    using InteropValue = arrange::core::InteropValue;
    using InteropReply = arrange::core::InteropReply;

    // 电平表：音频线程 push，UI 取走自上次以来的峰值，无新数据时保持最近电平
    class Meter {
       public:
        void push(float level) noexcept;
        float take() noexcept;

       private:
        std::atomic<float> latest_{0.0f};
        std::atomic<float> peak_{0.0f};
    };

    // 波形：单生产者环形缓冲，UI 读取最近若干样本，不消费数据
    class Waveform {
       public:
        explicit Waveform(std::size_t capacity);
        void push(const float* samples, std::size_t count) noexcept;

        [[nodiscard]] std::size_t capacity() const noexcept {
            return capacity_;
        }

        std::uint64_t read(std::span<float> out) const noexcept;

       private:
        std::size_t capacity_;
        std::unique_ptr<std::atomic<float>[]> samples_;
        std::atomic<std::uint64_t> written_{0};
    };

    // 频谱等定长数组：三缓冲，音频线程发布完整一份，UI 总读到最新完整的一份
    class Spectrum {
       public:
        explicit Spectrum(std::size_t size);
        void publish(const float* values, std::size_t count) noexcept;

        [[nodiscard]] std::size_t size() const noexcept {
            return size_;
        }

        bool read(std::span<float> out) noexcept;

       private:
        static constexpr int freshBit = 4;
        std::size_t size_;
        std::vector<float> buffers_[3];
        std::atomic<int> middle_{1};
        int back_ = 0;
        int front_ = 2;
    };

#if ARRANGE_JUCE_WITH_JUCE

    // processor 持有的互操作端点；寿命长于任何 Editor 与脚本会话
    class Interop final : public arrange::core::InteropHost, private ::juce::AudioProcessorParameter::Listener, private ::juce::Timer {
       public:
        using Handler = std::function<InteropValue(const InteropValue& args)>;
        using AsyncHandler = std::function<void(const InteropValue& args, InteropReply reply)>;

        explicit Interop(::juce::AudioProcessor& processor);
        ~Interop() override;

        Interop(const Interop&) = delete;
        Interop& operator=(const Interop&) = delete;

        // 以下两项在音频线程或 prepare 路径调用：只写原子量，不分配、不加锁、不投递消息
        void prepare(double sampleRate, int blockSize) noexcept;
        void process(::juce::AudioPlayHead* playHead) noexcept;

        // 以下在 message thread 调用；观测对象在音频开始前登记，引用长期有效
        Meter& meter(const std::string& name);
        Waveform& waveform(const std::string& name, std::size_t capacity = 8192);
        Spectrum& spectrum(const std::string& name, std::size_t size);
        void emit(std::string name, InteropValue value = {});
        void handle(std::string name, Handler handler);
        void handleAsync(std::string name, AsyncHandler handler);

        void attach(arrange::core::InteropSessionSink& sink) override;
        void detach(arrange::core::InteropSessionSink& sink) noexcept override;
        const std::vector<arrange::core::InteropParameter>& parameters() const override;
        float parameterValue(std::size_t index) const override;
        void takeParameterChanges(std::vector<std::size_t>& changed) override;
        double toPlain(std::size_t index, float normalized) const override;
        float toNormalized(std::size_t index, double plain) const override;
        std::string text(std::size_t index, float normalized) const override;
        std::optional<float> parse(std::size_t index, std::string_view text) const override;
        void beginGesture(std::size_t index) override;
        void setParameter(std::size_t index, float normalized) override;
        void endGesture(std::size_t index) override;
        bool showParameterMenu(std::size_t index) override;
        arrange::core::InteropHostInfo hostInfo() const override;
        arrange::core::InteropTransport transport() const override;
        bool hasMeter(std::string_view name) const override;
        float takeMeter(std::string_view name) override;
        std::optional<std::size_t> waveformCapacity(std::string_view name) const override;
        std::uint64_t readWaveform(std::string_view name, std::span<float> out) const override;
        std::optional<std::size_t> spectrumSize(std::string_view name) const override;
        bool readSpectrum(std::string_view name, std::span<float> out) override;
        void invoke(std::string_view name, const InteropValue& args, InteropReply reply) override;

       private:
        struct TransportCell {
            std::atomic<std::uint32_t> sequence{0};
            std::atomic<bool> playing{false};
            std::atomic<bool> recording{false};
            std::atomic<bool> looping{false};
            std::atomic<bool> hasBpm{false};
            std::atomic<double> bpm{0.0};
            std::atomic<int> numerator{0};
            std::atomic<int> denominator{0};
            std::atomic<bool> hasPpq{false};
            std::atomic<double> ppq{0.0};
            std::atomic<bool> hasSeconds{false};
            std::atomic<double> seconds{0.0};
        };

        void parameterValueChanged(int parameterIndex, float newValue) override;
        void parameterGestureChanged(int parameterIndex, bool gestureIsStarting) override;
        void timerCallback() override;
        ::juce::AudioProcessorParameter& parameter(std::size_t index) const;

        ::juce::AudioProcessor& processor_;
        std::vector<::juce::AudioProcessorParameter*> parameters_;
        std::vector<::juce::RangedAudioParameter*> ranged_;
        std::vector<arrange::core::InteropParameter> descriptors_;
        std::unique_ptr<std::atomic<bool>[]> changed_;
        std::atomic<bool> anyChanged_{false};
        std::atomic<bool> wakePending_{false};
        std::atomic<double> sampleRate_{0.0};
        std::atomic<int> blockSize_{0};
        TransportCell transport_;
        arrange::core::InteropTransport audioTransport_;
        std::map<std::string, std::unique_ptr<Meter>, std::less<>> meters_;
        std::map<std::string, std::unique_ptr<Waveform>, std::less<>> waveforms_;
        std::map<std::string, std::unique_ptr<Spectrum>, std::less<>> spectra_;
        std::map<std::string, AsyncHandler, std::less<>> handlers_;
        arrange::core::InteropSessionSink* sink_ = nullptr;
        mutable std::optional<std::string> hostName_;
    };

#endif
}
