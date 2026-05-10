#pragma once

#include <arrange/core/Paint.h>
#include <arrange/juce/DiagnosticsOverlay.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class DiagnosticsScene final {
    public:
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildErrorScreen(
            ::juce::Rectangle<int> editorBounds,
            const ErrorScreenModel& error,
            bool detailed) const;
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildBadge(
            ::juce::Rectangle<int> editorBounds,
            const DiagnosticsBadgeModel& model,
            DiagnosticVisibility visibility) const;
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildToasts(
            ::juce::Rectangle<int> editorBounds,
            const std::vector<DiagnosticsToastModel>& toasts,
            DiagnosticVisibility visibility) const;

    private:
        static arrange::core::Rect rect(::juce::Rectangle<int> value) noexcept;
        static arrange::core::DrawOp fill(arrange::core::Rect rect, std::uint32_t color, float radius = 0.0f);
        static arrange::core::DrawOp stroke(arrange::core::Rect rect, std::uint32_t color, float width = 1.0f, float radius = 0.0f);
        static arrange::core::DrawOp text(arrange::core::Rect rect, std::string value, std::uint32_t color, float fontSize, int maxLines = 1);
    };

#endif
} // namespace arrange::juce
