#include "ScrollProbe.h"

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/Log.h>
#include <juce_core/juce_core.h>

#include <chrono>
#include <exception>
#include <iomanip>
#include <locale>
#include <sstream>
#include <vector>

namespace arrange::juce {
    namespace {
        constexpr std::size_t maxSamples = 65536;
        constexpr std::string_view tag = "ScrollProbe";

        struct ProbeState {
            bool active = false;
            std::vector<ScrollProbe::Sample> samples;
            std::uint64_t dropped = 0;
            std::uint64_t inputSequence = 0;
            ScrollProbe::Sample lastConsumed;
            double startedMillis = 0;
            std::chrono::system_clock::time_point startedAt;
        };

        ProbeState probe;

        struct PhaseName {
            const char* chinese;
            const char* identifier;
        };

        PhaseName phaseName(ScrollProbe::Kind kind) noexcept {
            switch (kind) {
                case ScrollProbe::Kind::Input:
                    return {"输入", "Input"};
                case ScrollProbe::Kind::Route:
                    return {"路由", "Route"};
                case ScrollProbe::Kind::Queue:
                    return {"入队", "Queue"};
                case ScrollProbe::Kind::Dispatch:
                    return {"派发", "Dispatch"};
                case ScrollProbe::Kind::DispatchDone:
                    return {"回调完成", "DispatchDone"};
                case ScrollProbe::Kind::Batch:
                    return {"语义批次", "Batch"};
                case ScrollProbe::Kind::VBlank:
                    return {"帧信号", "VBlank"};
                case ScrollProbe::Kind::Publish:
                    return {"帧发布", "Publish"};
                case ScrollProbe::Kind::Paint:
                    return {"绘制", "Paint"};
                case ScrollProbe::Kind::PredictionReset:
                    return {"滚动预测清空", "PredictionReset"};
                case ScrollProbe::Kind::Clock:
                    return {"帧时钟状态", "Clock"};
            }
            return {"未知阶段", "Unknown"};
        }

        std::string sampleMessage(const ScrollProbe::Sample& sample) {
            const auto phase = phaseName(sample.kind);
            std::ostringstream out;
            out.imbue(std::locale::classic());
            out << std::fixed << std::setprecision(9);
            out << phase.chinese << " kind=" << phase.identifier << " timeMillis=" << sample.timeMillis << " sourceMillis=" << sample.sourceMillis << " x=" << sample.x << " y=" << sample.y << " deltaX=" << sample.deltaX << " deltaY=" << sample.deltaY << " value=" << sample.value << " maxValue=" << sample.maxValue << " durationMillis=" << sample.durationMillis;
            out << " sequence=" << sample.sequence << " revision=" << sample.revision << " target=" << sample.target << " queueDepth=" << sample.queueDepth << " processed=" << sample.processed << " inputSequence=" << sample.inputSequence << " previousRevision=" << sample.previousRevision << " modifierIdentity=" << sample.modifierIdentity;
            out << " inertial=" << sample.inertial << " smooth=" << sample.smooth << " horizontal=" << sample.horizontal << " consumed=" << sample.consumed << " interactive=" << sample.interactive << " valid=" << sample.valid << " budgetBreak=" << sample.budgetBreak << " changed=" << sample.changed << " pending=" << sample.pending << " reversed=" << sample.reversed << " peer=" << sample.peer;
            out << " sessionId=" << sample.sessionId << " phase=" << static_cast<int>(sample.phase) << " momentumPhase=" << static_cast<int>(sample.momentumPhase) << " unitX=" << static_cast<int>(sample.unitX) << " unitY=" << static_cast<int>(sample.unitY) << " nativePhases=" << sample.nativePhases << " locked=" << sample.locked << " sessionStarted=" << sample.sessionStarted << " sessionCancelled=" << sample.sessionCancelled;
            return out.str();
        }

        std::filesystem::path saveSamples() {
            const auto now = ::juce::Time::getCurrentTime();
            const auto name = "ArrangeScrollProbe-" + now.formatted("%Y%m%d-%H%M%S") + "-" + ::juce::String(now.getMilliseconds()).paddedLeft('0', 3);
            const auto file = ::juce::File::getSpecialLocation(::juce::File::tempDirectory).getNonexistentChildFile(name, ".log", false);
            std::ostringstream out;
            out.imbue(std::locale::classic());
            out << arrange::Log::format(arrange::LogLevel::Info, tag, "采样汇总 samples=" + std::to_string(probe.samples.size()) + " dropped=" + std::to_string(probe.dropped), probe.startedAt) << '\n';
            for (const auto& sample : probe.samples) {
                const auto elapsed = std::chrono::duration<double, std::milli>(sample.timeMillis - probe.startedMillis);
                const auto timestamp = probe.startedAt + std::chrono::duration_cast<std::chrono::system_clock::duration>(elapsed);
                out << arrange::Log::format(arrange::LogLevel::Debug, tag, sampleMessage(sample), timestamp) << '\n';
            }
            const auto content = out.str();
            if (!file.replaceWithData(content.data(), content.size())) {
                arrange::Log::e(tag, "滚动采样日志保存失败", file.getFullPathName().toStdString());
                return {};
            }
            return std::filesystem::path(file.getFullPathName().toStdString());
        }
    }

    bool ScrollProbe::active() noexcept {
        return probe.active;
    }

    std::uint64_t ScrollProbe::currentInputSequence() noexcept {
        return probe.inputSequence;
    }

    ScrollProbe::Sample ScrollProbe::lastConsumed() noexcept {
        return probe.lastConsumed;
    }

    void ScrollProbe::record(Sample sample) noexcept {
        if (!probe.active) return;
        sample.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
        if (sample.kind == Kind::Input) sample.inputSequence = ++probe.inputSequence;
        if (sample.inputSequence == 0) sample.inputSequence = probe.inputSequence;
        if (sample.kind == Kind::Route && sample.consumed) probe.lastConsumed = sample;
        if (probe.samples.size() >= maxSamples) {
            ++probe.dropped;
            return;
        }
        probe.samples.push_back(sample);
    }

    std::filesystem::path ScrollProbe::toggle() {
        if (!probe.active) {
            try {
                probe.samples.reserve(maxSamples);
            } catch (const std::exception& error) {
                arrange::Log::e(tag, "滚动采样缓冲区准备失败", error.what());
                return {};
            }
            probe.samples.clear();
            probe.dropped = 0;
            probe.inputSequence = 0;
            probe.lastConsumed = {};
            probe.startedMillis = ::juce::Time::getMillisecondCounterHiRes();
            probe.startedAt = std::chrono::system_clock::now();
            probe.active = true;
            arrange::Log::i(tag, "滚动采样已开始 capacity=" + std::to_string(maxSamples));
            return {};
        }

        probe.active = false;
        try {
            const auto path = saveSamples();
            arrange::Log::i(tag, "滚动采样已停止 samples=" + std::to_string(probe.samples.size()) + " dropped=" + std::to_string(probe.dropped) + " path=" + path.string());
            return path;
        } catch (const std::exception& error) {
            arrange::Log::e(tag, "滚动采样日志保存失败", error.what());
            return {};
        }
    }
}

#endif
