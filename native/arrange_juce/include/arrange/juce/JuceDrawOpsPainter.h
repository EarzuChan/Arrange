#pragma once

#include <arrange/core/LayoutNode.h>
#include <arrange/core/Paint.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE


    struct PaintReplayCounters {
        std::uint64_t fragmentsVisited = 0;
        std::uint64_t fragmentsSkipped = 0;
        std::uint64_t opsVisited = 0;
        std::uint64_t opsSkipped = 0;
        std::uint64_t textSubmissions = 0;
        double glyphSubmitMillis = 0;
    };

    class JuceDrawOpsPainter final {
    public:
        struct PaintResult {
            std::optional<ErrorScreenModel> error;
        };

        PaintResult paint(
            ::juce::Graphics& g,
            const std::vector<arrange::core::DrawOp>& ops,
            arrange::core::ModifierHandle focusedInputModifier = {},
            float focusedInputViewportX = 0.0f) const;

        PaintResult paint(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& root, arrange::core::ModifierHandle focusedInputModifier = {}, float viewportX = 0) const;
        void setCullingEnabled(bool enabled) noexcept { cullingEnabled_ = enabled; }
        PaintReplayCounters counters() const noexcept { return counters_; }
        void resetCounters() const noexcept { counters_ = {}; }

    private:
        bool invisible(::juce::Graphics& graphics, arrange::core::PaintBounds bounds) const;
        void replayFragment(::juce::Graphics& graphics, const arrange::core::PlacedPaintFragment& placed, arrange::core::ModifierHandle focusedInputModifier, float viewportX, float alpha) const;
        void replayOps(::juce::Graphics& graphics, const std::vector<arrange::core::DrawOp>& ops, arrange::core::ModifierHandle focusedInputModifier, float viewportX, float alpha, int& depth) const;
        void drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float viewportX, float alpha) const;
        bool cullingEnabled_ = true;
        mutable PaintReplayCounters counters_;
    };

#endif
} // namespace arrange::juce
