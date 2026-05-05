#pragma once

#include <arrange/core/Node.h>
#include <arrange/core/Paint.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ImageResourceCache;

    class JuceDrawOpsPainter final {
    public:
        struct PaintResult {
            std::optional<ErrorScreenModel> error;
        };

        PaintResult paint(
            ::juce::Graphics& g,
            const std::vector<arrange::core::DrawOp>& ops,
            ImageResourceCache& imageResources,
            std::optional<arrange::core::NodeId> focusedInputNode = std::nullopt,
            float focusedInputViewportX = 0.0f) const;

        void drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float horizontalViewportOffset = 0.0f) const;
    };

#endif
} // namespace arrange::juce
