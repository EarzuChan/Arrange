#include <arrange/juce/Interop.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using arrange::core::InteropValue;

namespace {
    void check(bool condition, const std::string& message) {
        if (!condition) throw std::runtime_error(message);
    }

    // 记录脚本会话对宿主的全部操作；report 调用承载脚本内的观察结果
    class FakeHost final : public arrange::core::InteropHost {
       public:
        FakeHost() {
            parameters_.push_back({"gain", "Gain", "dB", 0.5f, 0, false, false, -60.0, 0.0});
            parameters_.push_back({"mode", "Mode", "", 0.0f, 3, true, false, 0.0, 2.0});
        }

        std::vector<std::string> operations;
        std::vector<InteropValue> reports;
        arrange::core::InteropSessionSink* sink = nullptr;
        int attaches = 0;
        std::vector<float> values{0.25f, 0.0f};
        std::vector<std::size_t> pendingChanges;
        float meterLevel = 0.0f;
        std::uint64_t waveformCount = 0;

        void attach(arrange::core::InteropSessionSink& value) override {
            sink = &value;
            ++attaches;
        }
        void detach(arrange::core::InteropSessionSink& value) noexcept override {
            if (sink == &value) sink = nullptr;
        }
        const std::vector<arrange::core::InteropParameter>& parameters() const override { return parameters_; }
        float parameterValue(std::size_t index) const override { return values.at(index); }
        void takeParameterChanges(std::vector<std::size_t>& changed) override {
            changed.insert(changed.end(), pendingChanges.begin(), pendingChanges.end());
            pendingChanges.clear();
        }
        double toPlain(std::size_t index, float normalized) const override {
            const auto& p = parameters_.at(index);
            return p.minimum + (p.maximum - p.minimum) * normalized;
        }
        float toNormalized(std::size_t index, double plain) const override {
            const auto& p = parameters_.at(index);
            return static_cast<float>((plain - p.minimum) / (p.maximum - p.minimum));
        }
        std::string text(std::size_t index, float normalized) const override { return std::to_string(static_cast<int>(toPlain(index, normalized))); }
        std::optional<float> parse(std::size_t index, std::string_view text) const override { return toNormalized(index, std::stod(std::string(text))); }
        void beginGesture(std::size_t index) override { operations.push_back("begin " + std::to_string(index)); }
        void setParameter(std::size_t index, float normalized) override {
            values.at(index) = normalized;
            operations.push_back("set " + std::to_string(index) + " " + std::to_string(normalized));
        }
        void endGesture(std::size_t index) override { operations.push_back("end " + std::to_string(index)); }
        arrange::core::InteropHostInfo hostInfo() const override { return {"Fake DAW", "vst3", 48000.0, 256}; }
        arrange::core::InteropTransport transport() const override { return {}; }
        bool hasMeter(std::string_view name) const override { return name == "out"; }
        float takeMeter(std::string_view) override { return meterLevel; }
        std::optional<std::size_t> waveformCapacity(std::string_view name) const override { return name == "scope" ? std::optional<std::size_t>(16) : std::nullopt; }
        std::uint64_t readWaveform(std::string_view, std::span<float> out) const override {
            for (std::size_t i = 0; i < out.size(); ++i) out[i] = static_cast<float>(waveformCount - out.size() + i + 1);
            return waveformCount;
        }
        std::optional<std::size_t> spectrumSize(std::string_view) const override { return std::nullopt; }
        bool readSpectrum(std::string_view, std::span<float>) override { return false; }
        void invoke(std::string_view name, const InteropValue& args, arrange::core::InteropReply reply) override {
            if (name == "report") {
                reports.push_back(args);
                reply.resolve();
            } else if (name == "echo")
                reply.resolve(args);
            else
                reply.reject("未登记：" + std::string(name));
        }

       private:
        std::vector<arrange::core::InteropParameter> parameters_;
    };

    const InteropValue* findReport(const FakeHost& host, std::string_view kind) {
        for (const auto& report : host.reports)
            if (report["kind"].asString() == kind) return &report;
        return nullptr;
    }

    const char* sessionScript = R"JS(
        globalThis.__ARRANGE_NATIVE__.createNode(1, 'Root')
        const i = globalThis.__ARRANGE_NATIVE__.interop
        const report = value => i.invoke('report', value)
        let callId = -1
        i.install({
            parameters(ix, v) { report({ kind: 'parameters', ix: [...ix], v: [...v] }) },
            host() {}, transport() {}, spectrum() {},
            meter(name, v) { report({ kind: 'meter', name, v }) },
            waveform(name, d) { report({ kind: 'waveform', name, len: d.length, last: d[d.length - 1], typed: d instanceof Float32Array }) },
            message(name, v) { report({ kind: 'message', name, v }) },
            reply(id, ok, v, e) { if (id === callId) report({ kind: 'reply', ok, v, e }) },
        })
        const ps = i.parameters()
        if (ps.length !== 2 || ps[0].id !== 'gain' || ps[0].value !== 0.25 || ps[1].steps !== 3) throw new Error('参数表不符')
        if (i.toPlain(0, 0.5) !== -30 || i.text(0, 0.5) !== '-30') throw new Error('参数换算不符')
        const host = i.host()
        if (host.name !== 'Fake DAW' || host.format !== 'vst3' || host.sampleRate !== 48000) throw new Error('宿主信息不符')
        i.set(0, 0.5, true)
        i.gesture(1, 'begin')
        i.set(1, 1, false)
        let rejected = false
        try { i.set(1, 0.5, true) } catch (error) { rejected = error instanceof TypeError }
        if (!rejected) throw new Error('gesture 进行中的完整写入应被拒绝')
        rejected = false
        try { i.subscribe('meter', 'missing') } catch (error) { rejected = error instanceof RangeError }
        if (!rejected) throw new Error('未登记的电平表应被拒绝')
        i.subscribe('meter', 'out')
        i.subscribe('waveform', 'scope', 4)
        callId = i.invoke('echo', { a: [1, 'x', true, null] })
    )JS";

    void testSessionBridge() {
        FakeHost host;
        arrange::quickjs::QuickJsScriptHost script;
        script.setInteropHost(&host);
        int wakes = 0;
        script.setOwnerWake([&] { ++wakes; });
        const auto executed = script.executeModule("interop-session.js", sessionScript);
        check(executed.ok, "会话脚本失败：" + executed.error);
        check(host.attaches == 1 && host.sink, "会话未接入宿主");
        const std::vector<std::string> expected{"begin 0", "set 0 0.500000", "end 0", "begin 1", "set 1 1.000000"};
        check(host.operations == expected, "参数写入顺序不符");
        check(script.hasPendingVisualWork(), "观测订阅期间应保持帧需求");

        host.values[0] = 0.75f;
        host.pendingChanges = {0};
        host.meterLevel = 0.6f;
        host.waveformCount = 9;
        host.sink->message("hello", InteropValue::object({{"to", "world"}}));
        check(script.hasPendingSemanticWork(), "消息未形成待处理语义工作");
        // 唤醒触发的检查点不交付观测流，交付频率不随唤醒频率增长
        check(script.semanticCheckpoint(8).ok && !findReport(host, "meter") && !findReport(host, "waveform"), "非视觉帧检查点交付了观测流");
        check(script.semanticCheckpoint(16, true).ok, "第一次交付失败");
        check(script.semanticCheckpoint(32, true).ok, "第二次交付失败");

        const auto* parameters = findReport(host, "parameters");
        check(parameters && (*parameters)["ix"][0].asNumber(-1) == 0 && (*parameters)["v"][0].asNumber() == 0.75, "参数变化未交付");
        const auto* meter = findReport(host, "meter");
        check(meter && (*meter)["name"].asString() == "out" && std::abs((*meter)["v"].asNumber() - 0.6) < 1e-6, "电平未交付");
        const auto* waveform = findReport(host, "waveform");
        check(waveform && (*waveform)["len"].asNumber() == 4 && (*waveform)["last"].asNumber() == 9 && (*waveform)["typed"].asBool(), "波形未以 Float32Array 交付");
        const auto* message = findReport(host, "message");
        check(message && (*message)["name"].asString() == "hello" && (*message)["v"]["to"].asString() == "world", "消息未交付");
        const auto* reply = findReport(host, "reply");
        check(reply && (*reply)["ok"].asBool() && (*reply)["v"] == InteropValue::object({{"a", InteropValue::array({1, "x", true, nullptr})}}), "调用回执不符");

        // 数据未变化时不重复交付
        const auto count = host.reports.size();
        check(script.semanticCheckpoint(48, true).ok && script.semanticCheckpoint(64, true).ok, "空交付失败");
        check(host.reports.size() == count, "未变化的观测数据被重复交付");

        // 换会话：旧会话未结束的 gesture 由原生补齐，新会话重新接入
        check(script.executeModule("interop-next.js", "const n=globalThis.__ARRANGE_NATIVE__;n.createNode(1,'Root');n.interop.parameters()").ok, "新会话脚本失败");
        check(host.operations.back() == "end 1", "会话结束未补齐 gesture");
        check(host.attaches == 2 && host.sink, "新会话未接入");
        check(!script.hasPendingVisualWork(), "未安装驱动的会话不应产生帧需求");
    }

    class TestProcessor final : public ::juce::AudioProcessor {
       public:
        TestProcessor() {
            addParameter(gain = new ::juce::AudioParameterFloat(::juce::ParameterID("gain", 1), "Gain", ::juce::NormalisableRange<float>(-60.0f, 0.0f), -12.0f));
            addParameter(bypass = new ::juce::AudioParameterBool(::juce::ParameterID("bypass", 1), "Bypass", false));
        }

        ::juce::AudioParameterFloat* gain;
        ::juce::AudioParameterBool* bypass;

        const ::juce::String getName() const override { return "Test"; }
        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(::juce::AudioBuffer<float>&, ::juce::MidiBuffer&) override {}
        double getTailLengthSeconds() const override { return 0; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        ::juce::AudioProcessorEditor* createEditor() override { return nullptr; }
        bool hasEditor() const override { return false; }
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram(int) override {}
        const ::juce::String getProgramName(int) override { return {}; }
        void changeProgramName(int, const ::juce::String&) override {}
        void getStateInformation(::juce::MemoryBlock&) override {}
        void setStateInformation(const void*, int) override {}
    };

    class Sink final : public arrange::core::InteropSessionSink {
       public:
        int wakes = 0;
        std::vector<std::string> messages;
        void wake() override { ++wakes; }
        void message(std::string name, InteropValue) override { messages.push_back(std::move(name)); }
    };

    class FixedPlayHead final : public ::juce::AudioPlayHead {
       public:
        PositionInfo info;
        ::juce::Optional<PositionInfo> getPosition() const override { return info; }
    };

    void testJuceInterop() {
        TestProcessor processor;
        arrange::juce::Interop interop(processor);
        const auto& parameters = interop.parameters();
        check(parameters.size() == 2 && parameters[0].id == "gain" && parameters[0].minimum == -60.0 && parameters[1].boolean, "参数登记不符");
        check(std::abs(interop.toPlain(0, 0.5f) + 30.0) < 1e-4 && std::abs(interop.toNormalized(0, -30.0) - 0.5f) < 1e-4, "范围换算不符");

        Sink sink;
        interop.attach(sink);
        std::vector<std::size_t> changed;
        interop.takeParameterChanges(changed);
        check(changed.empty(), "接入后不应有历史变化");

        // 宿主自动化等外部写入经监听器标记
        processor.gain->setValueNotifyingHost(0.25f);
        interop.takeParameterChanges(changed);
        check(changed == std::vector<std::size_t>{0} && std::abs(interop.parameterValue(0) - 0.25f) < 1e-6, "参数变化未标记");
        interop.beginGesture(1);
        interop.setParameter(1, 1.0f);
        interop.endGesture(1);
        check(processor.bypass->get(), "参数写入未生效");

        auto& meter = interop.meter("out");
        meter.push(0.2f);
        meter.push(0.9f);
        meter.push(0.4f);
        check(interop.hasMeter("out") && interop.takeMeter("out") == 0.9f && interop.takeMeter("out") == 0.4f, "电平峰值保持不符");

        auto& waveform = interop.waveform("scope", 8);
        const float samples[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
        waveform.push(samples, 3);
        std::vector<float> window(5);
        check(interop.readWaveform("scope", window) == 3 && window == std::vector<float>{0, 0, 1, 2, 3}, "波形不足时应左侧补零");
        waveform.push(samples + 3, 7);
        check(interop.readWaveform("scope", window) == 10 && window == std::vector<float>{6, 7, 8, 9, 10}, "波形环绕读取不符");

        auto& spectrum = interop.spectrum("bins", 3);
        std::vector<float> bins(3);
        check(!interop.readSpectrum("bins", bins), "未发布时不应有新频谱");
        const float first[]{1, 2, 3};
        const float second[]{4, 5, 6};
        spectrum.publish(first, 3);
        spectrum.publish(second, 3);
        check(interop.readSpectrum("bins", bins) && bins == std::vector<float>{4, 5, 6} && !interop.readSpectrum("bins", bins), "频谱应读到最新一份且只读一次");

        interop.prepare(44100.0, 128);
        const auto info = interop.hostInfo();
        check(info.format == "unknown" && info.sampleRate == 44100.0 && info.blockSize == 128, "宿主信息不符");

        FixedPlayHead head;
        head.info.setIsPlaying(true);
        head.info.setBpm(128.0);
        head.info.setPpqPosition(4.5);
        interop.process(&head);
        const auto transport = interop.transport();
        check(transport.playing && transport.bpm == 128.0 && transport.positionPpq == 4.5 && !transport.numerator, "走带快照不符");
        interop.process(nullptr);
        check(!interop.transport().playing, "没有 PlayHead 时应视为停止");

        bool resolved = false;
        interop.handle("double", [](const InteropValue& args) { return InteropValue(args[0].asNumber() * 2); });
        interop.invoke("double", InteropValue::array({21}), arrange::core::InteropReply([&](arrange::core::InteropOutcome outcome) { resolved = outcome.ok && outcome.value.asNumber() == 42; }));
        check(resolved, "同步调用回执不符");
        bool rejected = false;
        interop.invoke("missing", {}, arrange::core::InteropReply([&](arrange::core::InteropOutcome outcome) { rejected = !outcome.ok; }));
        check(rejected, "未登记调用应被拒绝");
        interop.emit("ping");
        check(sink.messages == std::vector<std::string>{"ping"}, "消息未投递到会话");
        interop.detach(sink);
        interop.emit("lost");
        check(sink.messages.size() == 1, "会话断开后消息不应投递");
    }
}

int main() {
    try {
        testSessionBridge();
        ::juce::ScopedJuceInitialiser_GUI juce;
        testJuceInterop();
    } catch (const std::exception& error) {
        std::cerr << "arrange_interop 失败：" << error.what() << '\n';
        return 1;
    }
    std::cout << "arrange_interop 通过\n";
    return 0;
}
