#include <arrange/juce/TextInputLayoutModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace arrange::juce {
    TextInputLayoutModel::TextInputLayoutModel(arrange::core::TextLayoutService& textLayoutService) noexcept : textLayoutService_(textLayoutService) {}

    bool TextInputLayoutModel::allowsLineBreak(const arrange::core::ModifierInstance& instance) {
        return arrange::core::TextInputOverlayBuilder::allowsLineBreak(instance);
    }

    TextInputLayoutModel::Metrics TextInputLayoutModel::metrics(const arrange::core::ModifierInstance& instance, float viewportX) const {
        return arrange::core::TextInputOverlayBuilder::metrics(instance, viewportX);
    }

    TextInputLayoutModel::Layout TextInputLayoutModel::layout(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, float viewportY) const {
        return arrange::core::TextInputOverlayBuilder::layout(instance, text, viewportX, textLayoutService_, viewportY);
    }

    std::size_t TextInputLayoutModel::textIndexAtPoint(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, float x, float y, float viewportY) const {
        const auto layout = this->layout(instance, text, viewportX, viewportY);
        return textLayoutService_.byteIndexAtPoint(*layout.text, {x - layout.metrics.textLeft + layout.metrics.viewportX, y - layout.metrics.textTop + layout.metrics.viewportY});
    }

    ::juce::RectangleList<int> TextInputLayoutModel::textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end) const {
        ::juce::RectangleList<int> bounds;
        start = std::min(start, text.size());
        end = std::min(end, text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            const auto rect = textLayoutService_.caretRect(*layout.text, start, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop - layout.metrics.viewportY});
            bounds.add(::juce::Rectangle<int>(static_cast<int>(std::round(rect.x)), static_cast<int>(std::round(rect.y)), 1, static_cast<int>(std::round(rect.height))));
            return bounds;
        }

        for (const auto& rect : textLayoutService_.boundsForRange(*layout.text, start, end, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop - layout.metrics.viewportY})) {
            bounds.add(::juce::Rectangle<int>(static_cast<int>(std::round(rect.x)), static_cast<int>(std::round(rect.y)), std::max(1, static_cast<int>(std::round(rect.width))), static_cast<int>(std::round(rect.height))));
        }
        return bounds;
    }

    float TextInputLayoutModel::updatedViewportX(const arrange::core::ModifierInstance& instance, const std::string& text, std::size_t cursorIndex, float viewportX) const {
        const auto metrics = this->metrics(instance, viewportX);
        if (!metrics.singleLine) return 0.0f;

        const auto prepared = layout(instance, text, viewportX);
        const auto textWidth = prepared.text->width;
        const auto caretX = textLayoutService_.xForByteIndex(*prepared.text, cursorIndex);
        const auto margin = 3.0f;
        if (caretX - viewportX > metrics.textWidth - margin) viewportX = caretX - metrics.textWidth + margin;
        if (caretX - viewportX < margin) viewportX = caretX - margin;
        return std::clamp(viewportX, 0.0f, std::max(0.0f, textWidth - metrics.textWidth + margin));
    }

    float TextInputLayoutModel::updatedViewportY(const arrange::core::ModifierInstance& instance, const std::string& text, std::size_t cursorIndex, float viewportY) const {
        const auto prepared = layout(instance, text, 0, viewportY);
        if (prepared.metrics.singleLine) return 0;
        const auto caret = textLayoutService_.caretRect(*prepared.text, cursorIndex);
        if (caret.y < viewportY) viewportY = caret.y;
        if (caret.y + caret.height > viewportY + prepared.metrics.textHeight) viewportY = caret.y + caret.height - prepared.metrics.textHeight;
        return std::clamp(viewportY, 0.0f, std::max(0.0f, prepared.text->height - prepared.metrics.textHeight));
    }

}

#endif
