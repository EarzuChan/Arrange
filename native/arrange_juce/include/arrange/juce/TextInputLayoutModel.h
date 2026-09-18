#pragma once

#include <arrange/core/Paint.h>
#include <arrange/core/TextLayoutService.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <cstddef>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class TextInputLayoutModel final {
    public:
        using Metrics = arrange::core::TextInputOverlayBuilder::Metrics;
        using Layout = arrange::core::TextInputOverlayBuilder::Layout;

        explicit TextInputLayoutModel(arrange::core::TextLayoutService& textLayoutService) noexcept;

        static bool allowsLineBreak(const arrange::core::ArrangeNode& node);

        Metrics metrics(const arrange::core::ArrangeNode& node, float viewportX) const;
        Layout layout(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX) const;
        std::size_t textIndexAtPoint(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX, float x, float y) const;
        ::juce::RectangleList<int> textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end) const;
        float updatedViewportX(const arrange::core::ArrangeNode& node, const std::string& text, std::size_t cursorIndex, float viewportX) const;
        [[nodiscard]] arrange::core::TextLayoutService& textLayoutService() const noexcept { return textLayoutService_; }

    private:
        arrange::core::TextLayoutService& textLayoutService_;
    };

#endif
} // namespace arrange::juce
