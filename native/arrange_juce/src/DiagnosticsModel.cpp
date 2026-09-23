#include <arrange/juce/DiagnosticsModel.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <utility>

namespace arrange::juce {
    bool diagnosticVisibilityEnabled(DiagnosticVisibility visibility) noexcept {
        switch (visibility) {
            case DiagnosticVisibility::Hidden: return false;
            case DiagnosticVisibility::Always: return true;
            case DiagnosticVisibility::DebugOnly:
#if defined(NDEBUG)
                return false;
#else
                return true;
#endif
        }
        return false;
    }

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

    }  // namespace

    void DiagnosticsModel::configure(DiagnosticsConfig config) {
        config_ = std::move(config);
        toasts_.clear();
    }

    bool DiagnosticsModel::tick(double nowMillis) {
        if (toasts_.empty()) return false;
        const auto before = toasts_.size();
        toasts_.erase(std::remove_if(toasts_.begin(), toasts_.end(), [nowMillis](const Toast& toast) { return toast.expiresAtMs <= nowMillis; }), toasts_.end());
        return before != toasts_.size();
    }

    bool DiagnosticsModel::hasActiveToasts() const noexcept {
        return !toasts_.empty();
    }

    std::vector<DiagnosticsToastModel> DiagnosticsModel::activeToastModels() const {
        std::vector<DiagnosticsToastModel> models;
        models.reserve(toasts_.size());
        for (const auto& toast : toasts_) {
            models.push_back({toast.level, toast.title, toast.message});
        }
        return models;
    }

    void DiagnosticsModel::setToastsEnabled(bool enabled) noexcept {
        config_.toasts = enabled ? DiagnosticVisibility::Always : DiagnosticVisibility::Hidden;
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
        return out.str();
    }

    std::string DiagnosticsModel::currentLocalTimeLabel() {
        return formatTime(std::chrono::system_clock::now());
    }

    bool DiagnosticsModel::addToast(arrange::LogLevel level, std::string title, std::string message, double nowMillis, bool coalesce) {
        if (!visibilityEnabled(config_.toasts)) return false;
        if (coalesce) {
            for (auto& toast : toasts_) {
                if (toast.title == title) {
                    toast.level = level;
                    toast.message = message;
                    toast.expiresAtMs = nowMillis + 2500.0;
                    return true;
                }
            }
        }
        toasts_.push_back({level, std::move(title), std::move(message), nowMillis + 2500.0});
        while (toasts_.size() > 3) toasts_.erase(toasts_.begin());
        return true;
    }
}  // namespace arrange::juce

#endif
