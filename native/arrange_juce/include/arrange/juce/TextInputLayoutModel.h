#pragma once

#include <arrange/core/Paint.h>
#include <arrange/core/InputEditing.h>
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

        static bool allowsLineBreak(const arrange::core::ModifierInstance& instance);

        Metrics metrics(const arrange::core::ModifierInstance& instance, float viewportX) const;
        Layout layout(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, float viewportY = 0) const;
        std::size_t textIndexAtPoint(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, float x, float y, float viewportY = 0) const;
        arrange::core::TextSelectionRange selectionAtPoint(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, arrange::core::Point point, float viewportY, arrange::core::TextSelectionGranularity granularity) const;
        ::juce::RectangleList<int> textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end) const;
        float updatedViewportX(const arrange::core::ModifierInstance& instance, const std::string& text, std::size_t cursorIndex, float viewportX) const;
        float updatedViewportY(const arrange::core::ModifierInstance& instance, const std::string& text, std::size_t cursorIndex, float viewportY) const;

        [[nodiscard]] arrange::core::TextLayoutService& textLayoutService() const noexcept {
            return textLayoutService_;
        }

       private:
        arrange::core::TextLayoutService& textLayoutService_;
    };

#endif
}
