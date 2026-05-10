#pragma once

#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <filesystem>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct DiagnosticsBadgeModel {
        std::string text;
        ::juce::Colour dot = ::juce::Colour(0xffef4444);
    };

    struct DiagnosticsToastModel {
        LogLevel level = LogLevel::Info;
        std::string title;
        std::string message;
    };

    struct DiagnosticsTextContext {
        std::string activeSource;
        bool liveRuntimeEnabled = false;
        bool hasLive = false;
        bool hasDist = false;
        std::string devServerUrl;
        std::filesystem::path appPath;
        const ErrorScreenModel* error = nullptr;
    };

    class DiagnosticsOverlay final {
    public:
        void configure(DiagnosticsConfig config);

        bool emit(LogLevel level, std::string title, std::string message = {}, bool toast = false, bool coalesceToast = true);
        bool tick(double nowMillis);
        bool hasActiveToasts() const noexcept;
        [[nodiscard]] std::vector<DiagnosticsToastModel> activeToastModels() const;
        [[nodiscard]] DiagnosticVisibility badgeVisibility() const noexcept { return config_.badge; }
        [[nodiscard]] DiagnosticVisibility toastVisibility() const noexcept { return config_.toasts; }

        std::string diagnosticsText(const DiagnosticsTextContext& context) const;

        static std::string currentLocalTimeLabel();
        static bool visibilityEnabled(DiagnosticVisibility visibility) noexcept;

    private:
        struct Toast {
            LogLevel level = LogLevel::Info;
            std::string title;
            std::string message;
            double expiresAtMs = 0.0;
        };

        void recordEvent(LogLevel level, const std::string& title, const std::string& message);
        void writeLog(LogLevel level, const std::string& title, const std::string& message) const;
        bool pushToast(LogLevel level, std::string title, std::string message, double nowMillis, bool coalesce);

        DiagnosticsConfig config_;
        std::vector<Toast> toasts_;
        std::vector<std::string> events_;
    };

#endif
} // namespace arrange::juce
