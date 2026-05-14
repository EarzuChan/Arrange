#include <arrange/juce/DiagnosticsModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        std::string formatTime(std::chrono::system_clock::time_point time) {
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

        std::string recentEventLine(const DiagnosticEvent& event) {
            std::string line = "#" + std::to_string(event.id) + " " + formatTime(event.timestamp) + " [" + logLevelName(event.level) + "][" + diagnosticCategoryName(event.category) + "]";
            if (!event.code.empty()) line += "[" + event.code + "]";
            line += " " + event.message;
            if (!event.detail.empty()) line += " - " + event.detail;
            if (!event.pathOrUrl.empty()) line += " (" + event.pathOrUrl + ")";
            return line;
        }
    } // namespace

    void DiagnosticsModel::configure(DiagnosticsConfig config) {
        config_ = std::move(config);
        store_.configure(config_.recentEventLimit);
        logger_.configure(config_);
        toasts_.clear();
    }

    bool DiagnosticsModel::emit(DiagnosticEventInput input) {
        const auto coalesceToast = input.coalesceToast;
        const auto event = store_.append(std::move(input));
        logger_.write(event);
        if (!event.toastRequested) return false;
        return pushToast(event, ::juce::Time::getMillisecondCounterHiRes(), coalesceToast);
    }

    bool DiagnosticsModel::emit(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast) {
        DiagnosticEventInput input;
        input.level = level;
        input.category = DiagnosticCategory::Diagnostics;
        input.message = std::move(title);
        input.detail = std::move(message);
        input.toast = toast;
        input.coalesceToast = coalesceToast;
        return emit(std::move(input));
    }

    bool DiagnosticsModel::tick(double nowMillis) {
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

    bool DiagnosticsModel::hasActiveToasts() const noexcept { return !toasts_.empty(); }

    std::vector<DiagnosticsToastModel> DiagnosticsModel::activeToastModels() const {
        std::vector<DiagnosticsToastModel> models;
        models.reserve(toasts_.size());
        for (const auto& toast : toasts_) {
            models.push_back({toast.level, toast.title, toast.message});
        }
        return models;
    }

    void DiagnosticsModel::setLogLevel(LogLevel level) noexcept {
        config_.logLevel = level;
        logger_.setLogLevel(level);
    }

    void DiagnosticsModel::setCategoryEnabled(DiagnosticCategory category, bool enabled) {
        logger_.setCategoryEnabled(category, enabled);
    }

    void DiagnosticsModel::setToastsEnabled(bool enabled) noexcept {
        config_.toasts = enabled ? DiagnosticVisibility::Always : DiagnosticVisibility::Hidden;
    }

    bool DiagnosticsModel::categoryEnabled(DiagnosticCategory category) const {
        return logger_.categoryEnabled(category);
    }

    std::string DiagnosticsModel::diagnosticsText(const DiagnosticsTextContext& context) const {
        std::ostringstream out;
#if defined(NDEBUG)
        out << "buildMode: Release\n";
#else
        out << "buildMode: Debug\n";
#endif
        out << "activeSource: " << context.activeSource << "\n";
        out << "liveRuntimeEnabled: " << (context.liveRuntimeEnabled ? "true" : "false") << "\n";
        out << "hasLive: " << (context.hasLive ? "true" : "false") << "\n";
        out << "hasDist: " << (context.hasDist ? "true" : "false") << "\n";
        if (!context.devServerUrl.empty()) out << "devServerUrl: " << context.devServerUrl << "\n";
        if (!context.appPath.empty()) out << "appPath: " << context.appPath.string() << "\n";
        if (context.error != nullptr) {
            out << "\nerror:\n";
            out << context.error->diagnosticText();
        }
        if (!store_.recentEvents().empty()) {
            out << "\nrecentEvents:\n";
            for (const auto& event : store_.recentEvents()) out << recentEventLine(event) << "\n";
        }
        return out.str();
    }

    std::string DiagnosticsModel::currentLocalTimeLabel() {
        return formatTime(std::chrono::system_clock::now());
    }

    bool DiagnosticsModel::pushToast(const DiagnosticEvent& event, double nowMillis, bool coalesce) {
        if (!visibilityEnabled(config_.toasts)) return false;
        if (coalesce) {
            for (auto& toast : toasts_) {
                if (toast.title == event.message) {
                    toast.eventId = event.id;
                    toast.level = event.level;
                    toast.message = event.detail;
                    toast.expiresAtMs = nowMillis + 2500.0;
                    return true;
                }
            }
        }
        toasts_.push_back({event.id, event.level, event.message, event.detail, nowMillis + 2500.0});
        while (toasts_.size() > 3) toasts_.erase(toasts_.begin());
        return true;
    }
} // namespace arrange::juce

#endif
