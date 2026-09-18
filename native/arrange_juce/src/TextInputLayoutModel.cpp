#include <arrange/juce/TextInputLayoutModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace arrange::juce {
    TextInputLayoutModel::TextInputLayoutModel(arrange::core::TextLayoutService& textLayoutService) noexcept
        : textLayoutService_(textLayoutService) {}

    bool TextInputLayoutModel::allowsLineBreak(const arrange::core::ArrangeNode& node) {
        return arrange::core::TextInputOverlayBuilder::allowsLineBreak(node);
    }

    TextInputLayoutModel::Metrics TextInputLayoutModel::metrics(const arrange::core::ArrangeNode& node, float viewportX) const {
        return arrange::core::TextInputOverlayBuilder::metrics(node, viewportX);
    }

    TextInputLayoutModel::Layout TextInputLayoutModel::layout(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX) const {
        return arrange::core::TextInputOverlayBuilder::layout(node, text, viewportX, textLayoutService_);
    }

    std::size_t TextInputLayoutModel::textIndexAtPoint(
        const arrange::core::ArrangeNode& node,
        const std::string& text,
        float viewportX,
        float x,
        float y) const {
        const auto layout = this->layout(node, text, viewportX);
        return textLayoutService_.byteIndexAtPoint(
            *layout.text,
            {x - layout.metrics.textLeft + layout.metrics.viewportX, y - layout.metrics.textTop});
    }

    ::juce::RectangleList<int> TextInputLayoutModel::textBoundsForByteRange(
        const Layout& layout,
        const std::string& text,
        std::size_t start,
        std::size_t end) const {
        ::juce::RectangleList<int> bounds;
        start = std::min(start, text.size());
        end = std::min(end, text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            const auto rect = textLayoutService_.caretRect(*layout.text, start, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop});
            bounds.add(::juce::Rectangle<int>(
                static_cast<int>(std::round(rect.x)),
                static_cast<int>(std::round(rect.y)),
                1,
                static_cast<int>(std::round(rect.height))));
            return bounds;
        }

        for (const auto& rect : textLayoutService_.boundsForRange(*layout.text, start, end, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop})) {
            bounds.add(::juce::Rectangle<int>(
                static_cast<int>(std::round(rect.x)),
                static_cast<int>(std::round(rect.y)),
                std::max(1, static_cast<int>(std::round(rect.width))),
                static_cast<int>(std::round(rect.height))));
        }
        return bounds;
    }

    float TextInputLayoutModel::updatedViewportX(const arrange::core::ArrangeNode& node, const std::string& text, std::size_t cursorIndex, float viewportX) const {
        const auto metrics = this->metrics(node, viewportX);
        if (!metrics.singleLine) return 0.0f;

        const auto prepared = layout(node, text, viewportX);
        const auto textWidth = prepared.text->width;
        const auto caretX = textLayoutService_.xForByteIndex(*prepared.text, cursorIndex);
        const auto margin = 3.0f;
        if (caretX - viewportX > metrics.textWidth - margin) viewportX = caretX - metrics.textWidth + margin;
        if (caretX - viewportX < margin) viewportX = caretX - margin;
        return std::clamp(viewportX, 0.0f, std::max(0.0f, textWidth - metrics.textWidth + margin));
    }

} // namespace arrange::juce

#endif

