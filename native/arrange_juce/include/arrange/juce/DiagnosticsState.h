#pragma once

#include <arrange/core/Paint.h>
#include <arrange/juce/DiagnosticsModel.h>
#include <arrange/juce/DiagnosticsScene.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class DiagnosticsState final {
    public:
        void configure(DiagnosticsConfig config);

        bool hasError() const noexcept;
        const ErrorScreenModel* error() const noexcept;
        bool errorRetryAvailable() const noexcept;
        void setError(ErrorScreenModel error);
        void clearError() noexcept;

        bool emit(DiagnosticEventInput input);
        bool emit(LogLevel level, std::string title, std::string message = {}, bool toast = false, bool coalesceToast = true);
        bool tick(double nowMillis);
        bool hasActiveToasts() const noexcept;
        [[nodiscard]] std::vector<DiagnosticsToastModel> activeToastModels() const;
        [[nodiscard]] DiagnosticVisibility badgeVisibility() const noexcept;
        [[nodiscard]] DiagnosticVisibility toastVisibility() const noexcept;
        void setLogLevel(LogLevel level) noexcept;
        void setCategoryEnabled(DiagnosticCategory category, bool enabled);
        void setToastsEnabled(bool enabled) noexcept;
        [[nodiscard]] bool categoryEnabled(DiagnosticCategory category) const;
        [[nodiscard]] const std::vector<DiagnosticEvent>& recentEvents() const noexcept;

        void invalidatePreparedFrame() noexcept;
        [[nodiscard]] bool prepareFrame(
            ::juce::Rectangle<int> bounds,
            bool detailedErrorScreen,
            const DiagnosticsBadgeModel& badgeModel);
        [[nodiscard]] std::vector<arrange::core::DrawOp> errorOpsSnapshot() const { return preparedErrorOps_; }
        [[nodiscard]] std::vector<arrange::core::DrawOp> badgeOpsSnapshot() const { return preparedBadgeOps_; }
        [[nodiscard]] std::vector<arrange::core::DrawOp> toastOpsSnapshot() const { return preparedToastOps_; }

        bool copyErrorDiagnosticsToClipboard(DiagnosticsTextContext context);
        std::string diagnosticsText(DiagnosticsTextContext context) const;
        static std::string currentLocalTimeLabel();

    private:
        DiagnosticsModel model_;
        DiagnosticsScene diagnosticsScene_;
        std::optional<ErrorScreenModel> error_;
        std::vector<arrange::core::DrawOp> preparedErrorOps_;
        std::vector<arrange::core::DrawOp> preparedBadgeOps_;
        std::vector<arrange::core::DrawOp> preparedToastOps_;
        std::string preparedSignature_;
    };

#endif
} // namespace arrange::juce
