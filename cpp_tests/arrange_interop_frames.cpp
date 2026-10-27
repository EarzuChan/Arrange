#include "AllocationProbe.h"
#include "TextFixtures.h"
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/Interop.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/RuntimePackageBinder.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <chrono>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using namespace arrange::core;

// 量测 Demo App 各页逐帧开销：脚本检查点 + 布局 + paint 准备，以及软件光栅化
namespace {
    class DemoProcessor final : public ::juce::AudioProcessor {
       public:
        DemoProcessor() {
            addParameter(new ::juce::AudioParameterFloat(::juce::ParameterID("gain", 1), "Gain", ::juce::NormalisableRange<float>(-48.0f, 12.0f, 0.1f), 0.0f));
            addParameter(new ::juce::AudioParameterChoice(::juce::ParameterID("mode", 1), "Mode", ::juce::StringArray{"Clean", "Soft Clip", "Hard Clip"}, 0));
            addParameter(new ::juce::AudioParameterBool(::juce::ParameterID("bypass", 1), "Bypass", false));
        }

        const ::juce::String getName() const override {
            return "Bench";
        }

        void prepareToPlay(double, int) override {}

        void releaseResources() override {}

        void processBlock(::juce::AudioBuffer<float>&, ::juce::MidiBuffer&) override {}

        double getTailLengthSeconds() const override {
            return 0;
        }

        bool acceptsMidi() const override {
            return false;
        }

        bool producesMidi() const override {
            return false;
        }

        ::juce::AudioProcessorEditor* createEditor() override {
            return nullptr;
        }

        bool hasEditor() const override {
            return false;
        }

        int getNumPrograms() override {
            return 1;
        }

        int getCurrentProgram() override {
            return 0;
        }

        void setCurrentProgram(int) override {}

        const ::juce::String getProgramName(int) override {
            return {};
        }

        void changeProgramName(int, const ::juce::String&) override {}

        void getStateInformation(::juce::MemoryBlock&) override {}

        void setStateInformation(const void*, int) override {}
    };

    EventSlotId clickSlotOf(const NativeScene& scene, const std::string& text) {
        for (const auto id : scene.tree().nodeIds()) {
            if (test_support::textOf(scene.tree().node(id)) != text) continue;
            for (const auto& instance : scene.tree().node(id).modifier.elements()) {
                if (const auto* input = std::get_if<InputModifierSemantics>(&instance.descriptor.value); input && input->eventSlot.kind == EventSlotKind::Click) return input->eventSlot;
                if (const auto* layout = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value); layout && layout->eventSlot.kind == EventSlotKind::Click) return layout->eventSlot;
            }
        }
        throw std::runtime_error("未找到可点击文本：" + text);
    }
}

int main(int argc, char** argv) {
    try {
        ::juce::ScopedJuceInitialiser_GUI juceInitialiser;
        if (argc != 2) throw std::runtime_error("需要编译后的 Demo App 路径");
        DemoProcessor processor;
        arrange::juce::Interop interop(processor);
        auto& meter = interop.meter("output");
        auto& waveform = interop.waveform("output", 8192);
        auto& spectrum = interop.spectrum("output", 48);
        interop.prepare(48000.0, 512);
        interop.handle("presets", [](const arrange::juce::InteropValue&) { return arrange::juce::InteropValue::array({"Default"}); });

        auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        auto* script = host.get();
        host->setInteropHost(&interop);
        host->setPainterLoader(arrange::juce::packagePainterLoader(std::filesystem::path(argv[1]).parent_path()));
        arrange::quickjs::AppScriptLoader loader(*host);
        const auto loaded = loader.loadEntry(std::filesystem::path(argv[1]));
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        auto initial = host->takePendingTransaction();
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService textService(measurer);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{textService}}};
        runtime.setScriptHost(std::move(host));
        if (initial) runtime.enqueue(std::move(*initial));
        arrange::juce::PassivePaintRenderer painter(textService);
        ::juce::Image image(::juce::Image::ARGB, 900, 780, true);

        const Constraints constraints{0, 900, 0, 780};
        double timestamp = 0;
        std::vector<float> block(512);
        std::vector<float> bins(48);
        double phase = 0;
        const auto feed = [&] {
            for (auto& sample : block) sample = static_cast<float>(0.6 * std::sin(phase += 0.05));
            meter.push(0.6f);
            waveform.push(block.data(), block.size());
            for (std::size_t i = 0; i < bins.size(); ++i) bins[i] = static_cast<float>(0.5 + 0.4 * std::sin(phase * 0.01 + static_cast<double>(i)));
            spectrum.publish(bins.data(), bins.size());
        };
        const auto pump = [&] {
            const auto frame = runtime.pumpFrame(1, constraints, timestamp += 16.6);
            if (!frame.ok) throw std::runtime_error(frame.error);
        };
        const auto measure = [&](const char* label, bool audio, int frames) {
            for (int i = 0; i < 10; ++i) {
                if (audio) feed();
                pump();
            }
            double pumpTotal = 0, pumpWorst = 0, paintTotal = 0, paintWorst = 0;
            std::uint64_t nativeAllocations = 0;
            const auto scriptBefore = script->memoryStats();
            for (int i = 0; i < frames; ++i) {
                if (audio) feed();
                arrange::test::beginAllocationProbe();
                const auto start = std::chrono::steady_clock::now();
                pump();
                const auto pumped = std::chrono::steady_clock::now();
                {
                    ::juce::Graphics graphics(image);
                    graphics.fillAll(::juce::Colours::black);
                    painter.prepareResources(const_cast<PublishedFrameContent&>(runtime.publishedFrame().content));
                    painter.paint(graphics, runtime.publishedFrame());
                }
                const auto painted = std::chrono::steady_clock::now();
                nativeAllocations += arrange::test::endAllocationProbe().count;
                const auto pumpMs = std::chrono::duration<double, std::milli>(pumped - start).count();
                const auto paintMs = std::chrono::duration<double, std::milli>(painted - pumped).count();
                pumpTotal += pumpMs;
                paintTotal += paintMs;
                pumpWorst = std::max(pumpWorst, pumpMs);
                paintWorst = std::max(paintWorst, paintMs);
            }
            std::cout << label << " · 帧准备 平均 " << pumpTotal / frames << " ms / 最差 " << pumpWorst << " ms · 软件绘制 平均 " << paintTotal / frames << " ms / 最差 " << paintWorst << " ms · 每帧分配 JS " << (script->memoryStats().allocations - scriptBefore.allocations) / frames << "（系统堆 " << (script->memoryStats().systemAllocations - scriptBefore.systemAllocations) / frames << "）/ 原生 " << nativeAllocations / frames << " · 帧需求 " << (runtime.hasPendingVisualWork() ? "持续" : "无") << "\n";
        };
        const auto open = [&](const char* tab) {
            runtime.enqueueEvent(clickSlotOf(runtime.scene(), tab));
            for (int i = 0; i < 4; ++i) pump();
        };

        pump();
        measure("基础页", false, 120);
        open("展示与动画");
        measure("展示与动画页", false, 120);
        open("M3");
        measure("M3 页", false, 120);
        open("宿主互操作");
        measure("互操作页 · 无音频", false, 120);
        measure("互操作页 · 有音频", true, 120);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
