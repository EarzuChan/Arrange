#pragma once

#include <arrange/core/InputEditing.h>
#include <arrange/core/Node.h>
#include <arrange/core/TextLayoutService.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <cstddef>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class InputTextController final {
    public:
        struct Metrics {
            ::juce::Rectangle<float> rect;
            float textLeft = 0.0f;
            float textTop = 0.0f;
            float textWidth = 0.0f;
            float textHeight = 0.0f;
            float viewportX = 0.0f;
            float lineHeight = 12.0f;
            float fontSize = 14.0f;
            bool singleLine = true;
        };

        struct Layout {
            Metrics metrics;
            arrange::core::TextLayout text;
        };

        explicit InputTextController(arrange::core::TextLayoutService& textLayoutService) noexcept;

        static bool allowsLineBreak(const arrange::core::ArrangeNode& node);

        Metrics metrics(const arrange::core::ArrangeNode& node, float viewportX) const;
        Layout layout(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX) const;
        float xForByteIndex(const Layout& layout, const std::string& text, std::size_t index) const;
        std::size_t textIndexAtPoint(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX, float x, float y) const;
        ::juce::RectangleList<int> textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end) const;
        float updatedViewportX(const arrange::core::ArrangeNode& node, const std::string& text, std::size_t cursorIndex, float viewportX) const;

        void paintFocusedInput(
            ::juce::Graphics& g,
            const arrange::core::ArrangeNode& node,
            const arrange::core::TextInputState& state,
            float viewportX,
            const std::vector<::juce::Range<int>>& temporaryUnderlines) const;

    private:
        const arrange::core::TextLineLayout& lineForByteIndex(const Layout& layout, std::size_t index) const;

        arrange::core::TextLayoutService& textLayoutService_;
    };

#endif
} // namespace arrange::juce
