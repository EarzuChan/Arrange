#include <arrange/juce/DiagnosticsOverlay.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        const char* logLevelLabel(LogLevel level) noexcept {
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

        bool logLevelEnabled(LogLevel eventLevel, LogLevel configuredLevel) noexcept { return logLevelRank(eventLevel) >= logLevelRank(configuredLevel); }

    } // namespace

    void DiagnosticsOverlay::configure(DiagnosticsConfig config) {
        config_ = std::move(config);
        toasts_.clear();
        events_.clear();
    }

    bool DiagnosticsOverlay::emit(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast) {
        recordEvent(level, title, message);
        writeLog(level, title, message);
        if (!toast) return false;
        return pushToast(level, std::move(title), std::move(message), ::juce::Time::getMillisecondCounterHiRes(), coalesceToast);
    }

    bool DiagnosticsOverlay::tick(double nowMillis) {
        if (toasts_.empty()) return false;
        const auto before = toasts_.size();
        toasts_.erase(
            std::remove_if(
                toasts_.begin(),
                toasts_.end(),
                [nowMillis](const Toast& toast) { return toast.expiresAtMs <= nowMillis; }),
            toasts_.end());
        return before != toasts_.size();
    }

    bool DiagnosticsOverlay::hasActiveToasts() const noexcept { return !toasts_.empty(); }

    std::vector<DiagnosticsToastModel> DiagnosticsOverlay::activeToastModels() const {
        std::vector<DiagnosticsToastModel> models;
        models.reserve(toasts_.size());
        for (const auto& toast : toasts_) {
            models.push_back({toast.level, toast.title, toast.message});
        }
        return models;
    }

    std::string DiagnosticsOverlay::diagnosticsText(const DiagnosticsTextContext& context) const {
        std::ostringstream out;
#if defined(NDEBUG)
out<< "buildMode: Release\n";
#else
out<< "buildMode: Debug\n";
#endif
out<< "activeSource: " << context.activeSource<< "\n";
out<< "liveRuntimeEnabled: " << (context.liveRuntimeEnabled? "true" : "false") << "\n";
out<< "hasLive: " << (context.hasLive? "true" : "false") << "\n";
out<< "hasDist: " << (context.hasDist? "true" : "false") << "\n";
  if (!context.devServerUrl.empty()) out<< "devServerUrl: " << context.devServerUrl<< "\n";
  if (!context.appPath.empty()) out<< "appPath: " << context.appPath.string()<< "\n";
  if (context.error!= nullptr) {
    out << "\nerror:\n";
    out << context.error->diagnosticText();
  }
  if (!events_.empty()) {
    out << "\nrecentEvents:\n";
    for (const auto& event : events_) out << event << "\n";
  }
  return out.str();
}

std::string DiagnosticsOverlay::currentLocalTimeLabel() {
    const auto now = std::chrono::system_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;
    const auto nowTime = std::chrono::system_clock::to_time_t(now);
    std::tm localTime{};
#if defined(_WIN32)
localtime_s (&localTime, &nowTime);
#else
localtime_r (&nowTime, &localTime);
#endif
std::ostringstream out;
out<< std::put_time (&localTime, "%H:%M:%S") << "." << std::setw (3) << std::setfill ('0') << ms.count();
  return out.str();
}

bool DiagnosticsOverlay::visibilityEnabled(DiagnosticVisibility visibility) noexcept {
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

void DiagnosticsOverlay::recordEvent(LogLevel level, const std::string& title, const std::string& message) {
    auto line = std::string("[") + logLevelLabel(level) + "] " + title;
    if (!message.empty()) line += " - " + message;
    events_.push_back(std::move(line));
    while (events_.size() > 20) events_.erase(events_.begin());
}

void DiagnosticsOverlay::writeLog(LogLevel level, const std::string& title, const std::string& message) const {
    if (!logLevelEnabled(level, config_.logLevel)) return;
    auto line = std::string("[arrange][") + logLevelLabel(level) + "] " + title;
    if (!message.empty()) line += " - " + message;
    ::juce::Logger::writeToLog(::juce::String(line));
    if (config_.logFile.empty()) return;

    const auto file = ::juce::File(::juce::String(config_.logFile));
    const auto parent = file.getParentDirectory();
    if (parent.exists() || parent.createDirectory()) { if (file.appendText(::juce::String(line + "\n"), false, false, "\n")) return; }
    ::juce::Logger::writeToLog("Arrange diagnostic log sink failed: " + file.getFullPathName());
}

bool DiagnosticsOverlay::pushToast(LogLevel level, std::string title, std::string message, double nowMillis, bool coalesce) {
    if (!visibilityEnabled(config_.toasts)) return false;
    if (coalesce) {
        for (auto& toast : toasts_) {
            if (toast.title == title) {
                toast.level = level;
                toast.message = std::move(message);
                toast.expiresAtMs = nowMillis + 2500.0;
                return true;
            }
        }
    }
    toasts_.push_back({level, std::move(title), std::move(message), nowMillis + 2500.0});
    while (toasts_.size() > 3) toasts_.erase(toasts_.begin());
    return true;
}

} // namespace arrange::juce

#endif
