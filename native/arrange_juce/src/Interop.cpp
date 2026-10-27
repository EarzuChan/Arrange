#include <arrange/juce/Interop.h>

#include <algorithm>
#include <stdexcept>

namespace arrange::juce {
    void Meter::push(float level) noexcept {
        latest_.store(level, std::memory_order_relaxed);
        auto peak = peak_.load(std::memory_order_relaxed);
        while (level > peak && !peak_.compare_exchange_weak(peak, level, std::memory_order_relaxed)) {}
    }

    float Meter::take() noexcept {
        return peak_.exchange(latest_.load(std::memory_order_relaxed), std::memory_order_relaxed);
    }

    Waveform::Waveform(std::size_t capacity) : capacity_(capacity), samples_(std::make_unique<std::atomic<float>[]>(capacity)) {
        if (capacity == 0) throw std::invalid_argument("波形容量必须为正数");
        for (std::size_t i = 0; i < capacity; ++i) samples_[i].store(0.0f, std::memory_order_relaxed);
    }

    void Waveform::push(const float* samples, std::size_t count) noexcept {
        const auto written = written_.load(std::memory_order_relaxed);
        for (std::size_t i = 0; i < count; ++i) samples_[(written + i) % capacity_].store(samples[i], std::memory_order_relaxed);
        written_.store(written + count, std::memory_order_release);
    }

    std::uint64_t Waveform::read(std::span<float> out) const noexcept {
        const auto written = written_.load(std::memory_order_acquire);
        const auto count = std::min<std::size_t>(out.size(), capacity_);
        std::fill(out.begin(), out.end(), 0.0f);
        // 读取窗口靠右对齐，样本不足时左侧补零
        const auto offset = out.size() - count;
        for (std::size_t i = 0; i < count; ++i) {
            if (written + i < count) continue;
            out[offset + i] = samples_[(written - count + i) % capacity_].load(std::memory_order_relaxed);
        }
        return written;
    }

    Spectrum::Spectrum(std::size_t size) : size_(size) {
        if (size == 0) throw std::invalid_argument("频谱长度必须为正数");
        for (auto& buffer : buffers_) buffer.assign(size, 0.0f);
    }

    void Spectrum::publish(const float* values, std::size_t count) noexcept {
        auto& buffer = buffers_[back_];
        const auto copied = std::min(count, size_);
        std::copy_n(values, copied, buffer.begin());
        std::fill(buffer.begin() + static_cast<std::ptrdiff_t>(copied), buffer.end(), 0.0f);
        back_ = middle_.exchange(back_ | freshBit, std::memory_order_acq_rel) & 3;
    }

    bool Spectrum::read(std::span<float> out) noexcept {
        if ((middle_.load(std::memory_order_acquire) & freshBit) == 0) return false;
        front_ = middle_.exchange(front_, std::memory_order_acq_rel) & 3;
        std::fill(out.begin(), out.end(), 0.0f);
        std::copy_n(buffers_[front_].begin(), std::min(out.size(), size_), out.begin());
        return true;
    }

#if ARRANGE_JUCE_WITH_JUCE

    namespace {
        std::string formatName(::juce::AudioProcessor::WrapperType type) {
            switch (type) {
                case ::juce::AudioProcessor::wrapperType_Standalone:
                    return "standalone";
                case ::juce::AudioProcessor::wrapperType_VST3:
                    return "vst3";
                case ::juce::AudioProcessor::wrapperType_AudioUnit:
                case ::juce::AudioProcessor::wrapperType_AudioUnitv3:
                    return "au";
                case ::juce::AudioProcessor::wrapperType_AAX:
                    return "aax";
                case ::juce::AudioProcessor::wrapperType_LV2:
                    return "lv2";
                default:
                    return "unknown";
            }
        }

        constexpr int maxTextLength = 128;
    }

    Interop::Interop(::juce::AudioProcessor& processor) : processor_(processor) {
        for (auto* parameter : processor_.getParameters()) {
            auto* identified = dynamic_cast<::juce::AudioProcessorParameterWithID*>(parameter);
            if (!identified) throw std::invalid_argument("Interop 只支持 AudioProcessorParameterWithID 参数");
            auto* ranged = dynamic_cast<::juce::RangedAudioParameter*>(parameter);
            arrange::core::InteropParameter descriptor;
            descriptor.id = identified->paramID.toStdString();
            descriptor.name = parameter->getName(maxTextLength).toStdString();
            descriptor.label = parameter->getLabel().toStdString();
            descriptor.defaultNormalized = parameter->getDefaultValue();
            descriptor.discrete = parameter->isDiscrete();
            descriptor.boolean = parameter->isBoolean();
            descriptor.steps = descriptor.discrete || descriptor.boolean ? parameter->getNumSteps() : 0;
            if (ranged) {
                const auto& range = ranged->getNormalisableRange();
                descriptor.minimum = range.start;
                descriptor.maximum = range.end;
            }
            parameters_.push_back(parameter);
            ranged_.push_back(ranged);
            descriptors_.push_back(std::move(descriptor));
        }
        changed_ = std::make_unique<std::atomic<bool>[]>(parameters_.size());
        for (std::size_t i = 0; i < parameters_.size(); ++i) {
            changed_[i].store(false, std::memory_order_relaxed);
            parameters_[i]->addListener(this);
        }
    }

    Interop::~Interop() {
        cancelPendingUpdate();
        for (auto* parameter : parameters_) parameter->removeListener(this);
    }

    void Interop::prepare(double sampleRate, int blockSize) noexcept {
        sampleRate_.store(sampleRate, std::memory_order_relaxed);
        blockSize_.store(blockSize, std::memory_order_relaxed);
        triggerAsyncUpdate();
    }

    void Interop::process(::juce::AudioPlayHead* playHead) noexcept {
        arrange::core::InteropTransport next;
        if (playHead) {
            if (const auto position = playHead->getPosition()) {
                next.playing = position->getIsPlaying();
                next.recording = position->getIsRecording();
                next.looping = position->getIsLooping();
                if (const auto bpm = position->getBpm()) next.bpm = *bpm;
                if (const auto signature = position->getTimeSignature()) {
                    next.numerator = signature->numerator;
                    next.denominator = signature->denominator;
                }
                if (const auto ppq = position->getPpqPosition()) next.positionPpq = *ppq;
                if (const auto seconds = position->getTimeInSeconds()) next.positionSeconds = *seconds;
            }
        }
        auto& cell = transport_;
        const auto sequence = cell.sequence.load(std::memory_order_relaxed);
        cell.sequence.store(sequence + 1, std::memory_order_relaxed);
        std::atomic_thread_fence(std::memory_order_release);
        cell.playing.store(next.playing, std::memory_order_relaxed);
        cell.recording.store(next.recording, std::memory_order_relaxed);
        cell.looping.store(next.looping, std::memory_order_relaxed);
        cell.hasBpm.store(next.bpm.has_value(), std::memory_order_relaxed);
        cell.bpm.store(next.bpm.value_or(0.0), std::memory_order_relaxed);
        cell.numerator.store(next.numerator.value_or(0), std::memory_order_relaxed);
        cell.denominator.store(next.denominator.value_or(0), std::memory_order_relaxed);
        cell.hasPpq.store(next.positionPpq.has_value(), std::memory_order_relaxed);
        cell.ppq.store(next.positionPpq.value_or(0.0), std::memory_order_relaxed);
        cell.hasSeconds.store(next.positionSeconds.has_value(), std::memory_order_relaxed);
        cell.seconds.store(next.positionSeconds.value_or(0.0), std::memory_order_relaxed);
        cell.sequence.store(sequence + 2, std::memory_order_release);

        // 只在状态边沿唤醒 UI；播放位置由 UI 在订阅期间逐帧拉取
        const auto& previous = audioTransport_;
        const auto edge = next.playing != previous.playing || next.recording != previous.recording || next.looping != previous.looping || next.bpm != previous.bpm || next.numerator != previous.numerator || next.denominator != previous.denominator;
        audioTransport_ = next;
        if (edge) triggerAsyncUpdate();
    }

    arrange::core::InteropTransport Interop::transport() const {
        const auto& cell = transport_;
        arrange::core::InteropTransport result;
        while (true) {
            const auto before = cell.sequence.load(std::memory_order_acquire);
            if (before & 1u) continue;
            result.playing = cell.playing.load(std::memory_order_relaxed);
            result.recording = cell.recording.load(std::memory_order_relaxed);
            result.looping = cell.looping.load(std::memory_order_relaxed);
            result.bpm = cell.hasBpm.load(std::memory_order_relaxed) ? std::optional(cell.bpm.load(std::memory_order_relaxed)) : std::nullopt;
            const auto numerator = cell.numerator.load(std::memory_order_relaxed);
            const auto denominator = cell.denominator.load(std::memory_order_relaxed);
            result.numerator = numerator > 0 ? std::optional(numerator) : std::nullopt;
            result.denominator = denominator > 0 ? std::optional(denominator) : std::nullopt;
            result.positionPpq = cell.hasPpq.load(std::memory_order_relaxed) ? std::optional(cell.ppq.load(std::memory_order_relaxed)) : std::nullopt;
            result.positionSeconds = cell.hasSeconds.load(std::memory_order_relaxed) ? std::optional(cell.seconds.load(std::memory_order_relaxed)) : std::nullopt;
            std::atomic_thread_fence(std::memory_order_acquire);
            if (cell.sequence.load(std::memory_order_relaxed) == before) return result;
        }
    }

    Meter& Interop::meter(const std::string& name) {
        auto& slot = meters_[name];
        if (!slot) slot = std::make_unique<Meter>();
        return *slot;
    }

    Waveform& Interop::waveform(const std::string& name, std::size_t capacity) {
        auto& slot = waveforms_[name];
        if (!slot) slot = std::make_unique<Waveform>(capacity);
        else if (slot->capacity() != capacity) throw std::invalid_argument("波形 " + name + " 已按其它容量登记");
        return *slot;
    }

    Spectrum& Interop::spectrum(const std::string& name, std::size_t size) {
        auto& slot = spectra_[name];
        if (!slot) slot = std::make_unique<Spectrum>(size);
        else if (slot->size() != size) throw std::invalid_argument("频谱 " + name + " 已按其它长度登记");
        return *slot;
    }

    void Interop::emit(std::string name, InteropValue value) {
        if (!::juce::MessageManager::existsAndIsCurrentThread()) throw std::logic_error("Interop::emit 只能在 message thread 调用");
        // 没有连接的会话时丢弃：消息不重放
        if (sink_) sink_->message(std::move(name), std::move(value));
    }

    void Interop::handle(std::string name, Handler handler) {
        handleAsync(std::move(name), [handler = std::move(handler)](const InteropValue& args, InteropReply reply) { reply.resolve(handler(args)); });
    }

    void Interop::handleAsync(std::string name, AsyncHandler handler) {
        handlers_[std::move(name)] = std::move(handler);
    }

    void Interop::invoke(std::string_view name, const InteropValue& args, InteropReply reply) {
        const auto found = handlers_.find(name);
        if (found == handlers_.end()) {
            reply.reject("未登记的原生调用：" + std::string(name));
            return;
        }
        found->second(args, reply);
    }

    void Interop::attach(arrange::core::InteropSessionSink& sink) {
        sink_ = &sink;
        // 新会话按当前值整体对齐，历史变化标记不再有意义
        for (std::size_t i = 0; i < parameters_.size(); ++i) changed_[i].store(false, std::memory_order_relaxed);
        anyChanged_.store(false, std::memory_order_relaxed);
    }

    void Interop::detach(arrange::core::InteropSessionSink& sink) noexcept {
        if (sink_ == &sink) sink_ = nullptr;
    }

    const std::vector<arrange::core::InteropParameter>& Interop::parameters() const {
        return descriptors_;
    }

    ::juce::AudioProcessorParameter& Interop::parameter(std::size_t index) const {
        if (index >= parameters_.size()) throw std::out_of_range("参数下标越界");
        return *parameters_[index];
    }

    float Interop::parameterValue(std::size_t index) const {
        return parameter(index).getValue();
    }

    void Interop::takeParameterChanges(std::vector<std::size_t>& changed) {
        if (!anyChanged_.exchange(false, std::memory_order_acq_rel)) return;
        for (std::size_t i = 0; i < parameters_.size(); ++i)
            if (changed_[i].exchange(false, std::memory_order_acq_rel)) changed.push_back(i);
    }

    double Interop::toPlain(std::size_t index, float normalized) const {
        (void)parameter(index);
        return ranged_[index] ? ranged_[index]->convertFrom0to1(normalized) : normalized;
    }

    float Interop::toNormalized(std::size_t index, double plain) const {
        (void)parameter(index);
        return ranged_[index] ? ranged_[index]->convertTo0to1(static_cast<float>(plain)) : static_cast<float>(plain);
    }

    std::string Interop::text(std::size_t index, float normalized) const {
        return parameter(index).getText(normalized, maxTextLength).toStdString();
    }

    std::optional<float> Interop::parse(std::size_t index, std::string_view text) const {
        return parameter(index).getValueForText(::juce::String::fromUTF8(text.data(), static_cast<int>(text.size())));
    }

    void Interop::beginGesture(std::size_t index) {
        parameter(index).beginChangeGesture();
    }

    void Interop::setParameter(std::size_t index, float normalized) {
        parameter(index).setValueNotifyingHost(std::clamp(normalized, 0.0f, 1.0f));
    }

    void Interop::endGesture(std::size_t index) {
        parameter(index).endChangeGesture();
    }

    arrange::core::InteropHostInfo Interop::hostInfo() const {
        arrange::core::InteropHostInfo info;
        // 宿主在运行期不变；PluginHostType 每次都要探测宿主路径，检查点逐帧调用时只探测一次
        if (!hostName_) hostName_ = processor_.wrapperType == ::juce::AudioProcessor::wrapperType_Standalone ? std::string() : std::string(::juce::PluginHostType().getHostDescription());
        info.name = *hostName_;
        info.format = formatName(processor_.wrapperType);
        info.sampleRate = sampleRate_.load(std::memory_order_relaxed);
        info.blockSize = blockSize_.load(std::memory_order_relaxed);
        return info;
    }

    bool Interop::hasMeter(std::string_view name) const {
        return meters_.contains(name);
    }

    float Interop::takeMeter(std::string_view name) {
        const auto found = meters_.find(name);
        return found == meters_.end() ? 0.0f : found->second->take();
    }

    std::optional<std::size_t> Interop::waveformCapacity(std::string_view name) const {
        const auto found = waveforms_.find(name);
        return found == waveforms_.end() ? std::nullopt : std::optional(found->second->capacity());
    }

    std::uint64_t Interop::readWaveform(std::string_view name, std::span<float> out) const {
        const auto found = waveforms_.find(name);
        return found == waveforms_.end() ? 0 : found->second->read(out);
    }

    std::optional<std::size_t> Interop::spectrumSize(std::string_view name) const {
        const auto found = spectra_.find(name);
        return found == spectra_.end() ? std::nullopt : std::optional(found->second->size());
    }

    bool Interop::readSpectrum(std::string_view name, std::span<float> out) {
        const auto found = spectra_.find(name);
        return found != spectra_.end() && found->second->read(out);
    }

    void Interop::parameterValueChanged(int parameterIndex, float) {
        // 可能来自音频线程或宿主任意线程：只写标记，唤醒请求由 AsyncUpdater 合并
        // 登记顺序即 processor 扁平参数表顺序，下标与 getParameterIndex 一致
        if (parameterIndex < 0 || static_cast<std::size_t>(parameterIndex) >= parameters_.size()) return;
        changed_[static_cast<std::size_t>(parameterIndex)].store(true, std::memory_order_release);
        anyChanged_.store(true, std::memory_order_release);
        triggerAsyncUpdate();
    }

    void Interop::parameterGestureChanged(int, bool) {}

    void Interop::handleAsyncUpdate() {
        if (sink_) sink_->wake();
    }

#endif
}
