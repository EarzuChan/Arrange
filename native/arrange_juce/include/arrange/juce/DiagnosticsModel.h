#pragma once

#include <arrange/juce/DiagnosticEvent.h>

#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class DiagnosticsModel final {
    public:
        void configure(DiagnosticsConfig config);

        bool emit(DiagnosticEventInput input);
        bool emit(LogLevel level, std::string title, std::string message = {}, bool toast = false, bool coalesceToast = true);
        bool tick(double nowMillis);
        bool hasActiveToasts() const noexcept;
        [[nodiscard]] std::vector<DiagnosticsToastModel> activeToastModels() const;
        [[nodiscard]] DiagnosticVisibility badgeVisibility() const noexcept { return config_.badge; }
        [[nodiscard]] DiagnosticVisibility toastVisibility() const noexcept { return config_.toasts; }

        void setLogLevel(LogLevel level) noexcept;
        void setCategoryEnabled(DiagnosticCategory category, bool enabled);
        void setToastsEnabled(bool enabled) noexcept;
        [[nodiscard]] bool categoryEnabled(DiagnosticCategory category) const;
        [[nodiscard]] const std::vector<DiagnosticEvent>& recentEvents() const noexcept { return store_.recentEvents(); }

        std::string diagnosticsText(const DiagnosticsTextContext& context) const;

        static std::string currentLocalTimeLabel();
        static bool visibilityEnabled(DiagnosticVisibility visibility) noexcept { return diagnosticVisibilityEnabled(visibility); }

    private:
        struct Toast {
            std::uint64_t eventId = 0;
            LogLevel level = LogLevel::Info;
            std::string title;
            std::string message;
            double expiresAtMs = 0.0;
        };

        bool pushToast(const DiagnosticEvent& event, double nowMillis, bool coalesce);

        DiagnosticsConfig config_;
        DiagnosticEventStore store_;
        DiagnosticLogger logger_;
        std::vector<Toast> toasts_;
    };

#endif
} // namespace arrange::juce
