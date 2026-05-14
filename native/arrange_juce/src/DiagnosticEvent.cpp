#include <arrange/juce/DiagnosticEvent.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <iomanip>
#include <sstream>

namespace arrange::juce {
    namespace {
        bool logLevelEnabled(LogLevel eventLevel, LogLevel configuredLevel) noexcept {
            return logLevelRank(eventLevel) >= logLevelRank(configuredLevel);
        }

        std::string formatTimestamp(std::chrono::system_clock::time_point time) {
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch()) % 1000;
            const auto nowTime = std::chrono::system_clock::to_time_t(time);
            std::tm localTime{};
#if defined(_WIN32)
            localtime_s(&localTime, &nowTime);
#else
            localtime_r(&nowTime, &localTime);
#endif
            std::ostringstream out;
            out << std::put_time(&localTime, "%H:%M:%S") << "." << std::setw(3) << std::setfill('0') << ms.count();
            return out.str();
        }

        std::string formatEventLine(const DiagnosticEvent& event) {
            std::string line = "[" + formatTimestamp(event.timestamp) + "][arrange][" + logLevelName(event.level) + "][" + diagnosticCategoryName(event.category) + "]";
            if (!event.code.empty()) line += "[" + event.code + "]";
            line += " " + event.message;
            if (!event.detail.empty()) line += " - " + event.detail;
            if (!event.pathOrUrl.empty()) line += " (" + event.pathOrUrl + ")";
            return line;
        }
    } // namespace

    const char* diagnosticCategoryName(DiagnosticCategory category) noexcept {
        switch (category) {
        case DiagnosticCategory::App: return "app";
        case DiagnosticCategory::HostLive: return "host.live";
        case DiagnosticCategory::HostDist: return "host.dist";
        case DiagnosticCategory::HostHmr: return "host.hmr";
        case DiagnosticCategory::RuntimeScript: return "runtime.script";
        case DiagnosticCategory::RuntimeTransaction: return "runtime.transaction";
        case DiagnosticCategory::PipelineFrame: return "pipeline.frame";
        case DiagnosticCategory::PipelineLayout: return "pipeline.layout";
        case DiagnosticCategory::PipelinePaint: return "pipeline.paint";
        case DiagnosticCategory::InputPointer: return "input.pointer";
        case DiagnosticCategory::InputKey: return "input.key";
        case DiagnosticCategory::InputIme: return "input.ime";
        case DiagnosticCategory::InputScroll: return "input.scroll";
        case DiagnosticCategory::ResourcePackage: return "resource.package";
        case DiagnosticCategory::ResourceImage: return "resource.image";
        case DiagnosticCategory::ResourceIcon: return "resource.icon";
        case DiagnosticCategory::Diagnostics: return "diagnostics";
        }
        return "diagnostics";
    }

    const char* logLevelName(LogLevel level) noexcept {
        switch (level) {
        case LogLevel::Trace: return "trace";
        case LogLevel::Debug: return "debug";
        case LogLevel::Info: return "info";
        case LogLevel::Warn: return "warn";
        case LogLevel::Error: return "error";
        }
        return "info";
    }

    int logLevelRank(LogLevel level) noexcept {
        switch (level) {
        case LogLevel::Trace: return 0;
        case LogLevel::Debug: return 1;
        case LogLevel::Info: return 2;
        case LogLevel::Warn: return 3;
        case LogLevel::Error: return 4;
        }
        return 2;
    }

    bool diagnosticVisibilityEnabled(DiagnosticVisibility visibility) noexcept {
        switch (visibility) {
        case DiagnosticVisibility::Hidden:
            return false;
        case DiagnosticVisibility::Always:
            return true;
        case DiagnosticVisibility::DebugOnly:
#if defined(NDEBUG)
            return false;
#else
            return true;
#endif
        }
        return false;
    }

    void DiagnosticEventStore::configure(std::size_t recentLimit) {
        recentLimit_ = std::max<std::size_t>(1, recentLimit);
        while (events_.size() > recentLimit_) events_.erase(events_.begin());
    }

    void DiagnosticEventStore::clear() {
        events_.clear();
        nextId_ = 1;
    }

    DiagnosticEvent DiagnosticEventStore::append(DiagnosticEventInput input) {
        DiagnosticEvent event;
        event.id = nextId_++;
        event.timestamp = std::chrono::system_clock::now();
        event.level = input.level;
        event.category = input.category;
        event.code = std::move(input.code);
        event.message = std::move(input.message);
        event.detail = std::move(input.detail);
        event.source = std::move(input.source);
        event.pathOrUrl = std::move(input.pathOrUrl);
        event.toastRequested = input.toast;
        events_.push_back(event);
        while (events_.size() > recentLimit_) events_.erase(events_.begin());
        return event;
    }

    void DiagnosticLogger::configure(DiagnosticsConfig config) {
        config_ = std::move(config);
    }

    void DiagnosticLogger::setCategoryEnabled(DiagnosticCategory category, bool enabled) {
        categoryEnabled_[category] = enabled;
    }

    bool DiagnosticLogger::categoryEnabled(DiagnosticCategory category) const {
        const auto it = categoryEnabled_.find(category);
        return it == categoryEnabled_.end() ? true : it->second;
    }

    bool DiagnosticLogger::shouldWrite(const DiagnosticEvent& event) const noexcept {
        return logLevelEnabled(event.level, config_.logLevel);
    }

    void DiagnosticLogger::write(const DiagnosticEvent& event) const {
        if (!categoryEnabled(event.category) || !shouldWrite(event)) return;
        const auto line = formatEventLine(event);
        ::juce::Logger::writeToLog(::juce::String(line));
        if (config_.logFile.empty()) return;

        // 同步 file sink 只能用于安全线程和低频诊断路径；禁止在 audio thread、paint、pointer move、逐帧 layout/paint 中依赖同步文件 I/O。
        const auto file = ::juce::File(::juce::String(config_.logFile));
        const auto parent = file.getParentDirectory();
        if (parent.exists() || parent.createDirectory()) {
            if (file.appendText(::juce::String(line + "\n"), false, false, "\n")) return;
        }
        ::juce::Logger::writeToLog("Arrange diagnostic log sink failed: " + file.getFullPathName());
    }
} // namespace arrange::juce

#endif
