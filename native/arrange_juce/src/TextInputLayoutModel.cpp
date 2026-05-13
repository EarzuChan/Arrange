#include <arrange/juce/TextInputLayoutModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace arrange::juce {
    namespace {
        bool nodeBoolProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase, bool fallback) { const auto* value = arrange::core::propValue(node, camelCase, kebabCase == nullptr ? std::string_view{} : std::string_view{kebabCase}); return value == nullptr ? fallback : value->boolOr(fallback); }

        float nodeNumberProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase, float fallback) { const auto* value = arrange::core::propValue(node, camelCase, kebabCase == nullptr ? std::string_view{} : std::string_view{kebabCase}); return value == nullptr ? fallback : value->numberOr(fallback); }
    } // namespace

    TextInputLayoutModel::TextInputLayoutModel(arrange::core::TextLayoutService& textLayoutService) noexcept
        : textLayoutService_(textLayoutService) {}

    bool TextInputLayoutModel::allowsLineBreak(const arrange::core::ArrangeNode& node) {
        if (!nodeBoolProp(node, "singleLine", "single-line", true)) return true;
        if (nodeNumberProp(node, "minLines", "min-lines", 1.0f) > 1.0f) return true;
        if (nodeNumberProp(node, "maxLines", "max-lines", 1.0f) > 1.0f) return true;
        return false;
    }

    TextInputLayoutModel::Metrics TextInputLayoutModel::metrics(const arrange::core::ArrangeNode& node, float viewportX) const {
        Metrics metrics;
        metrics.rect = ::juce::Rectangle<float>(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
        const auto style = arrange::core::objectProp(node, "textStyle", "text-style");
        metrics.fontSize = style.number("fontSize", 14.0f);
        metrics.singleLine = !allowsLineBreak(node);
        metrics.textLeft = metrics.rect.getX() + 8.0f;
        metrics.textWidth = std::max(0.0f, metrics.rect.getWidth() - 16.0f);
        metrics.lineHeight = std::max(metrics.fontSize, style.number("lineHeight", metrics.fontSize));
        metrics.textTop = metrics.singleLine
                              ? metrics.rect.getY() + std::max(0.0f, (metrics.rect.getHeight() - metrics.lineHeight) * 0.5f)
                              : metrics.rect.getY() + 4.0f;
        metrics.textHeight = metrics.singleLine ? std::min(metrics.rect.getHeight(), metrics.lineHeight) : std::max(0.0f, metrics.rect.getHeight() - 8.0f);
        metrics.viewportX = metrics.singleLine ? viewportX : 0.0f;
        return metrics;
    }

    TextInputLayoutModel::Layout TextInputLayoutModel::layout(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX) const {
        Layout layout;
        layout.metrics = metrics(node, viewportX);
        layout.text = textLayoutService_.layout(
            text,
            {layout.metrics.fontSize, layout.metrics.lineHeight},
            {layout.metrics.singleLine ? 1 : 0, layout.metrics.singleLine ? 0.0f : layout.metrics.textWidth, layout.metrics.singleLine});
        return layout;
    }

    const arrange::core::TextLineLayout& TextInputLayoutModel::lineForByteIndex(const Layout& layout, std::size_t index) const {
        const auto clamped = std::min(index, layout.text.text.size());
        for (const auto& line : layout.text.lines) { if (clamped >= line.start && clamped <= line.end) return line; }
        return layout.text.lines.back();
    }

    float TextInputLayoutModel::xForByteIndex(const Layout& layout, const std::string& text, std::size_t index) const {
        if (layout.metrics.singleLine) { return layout.metrics.textLeft - layout.metrics.viewportX + juceTextXForByteIndex(text, index, layout.metrics.fontSize); }
        return layout.metrics.textLeft - layout.metrics.viewportX + textLayoutService_.xForByteIndex(layout.text, index);
    }

    std::size_t TextInputLayoutModel::textIndexAtPoint(
        const arrange::core::ArrangeNode& node,
        const std::string& text,
        float viewportX,
        float x,
        float y) const {
        const auto layout = this->layout(node, text, viewportX);
        if (layout.metrics.singleLine) { return juceByteIndexAtSingleLineX(text, x - layout.metrics.textLeft + layout.metrics.viewportX, layout.metrics.fontSize); }
        return textLayoutService_.byteIndexAtPoint(
            layout.text,
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

        if (layout.metrics.singleLine) {
            const auto originX = layout.metrics.textLeft - layout.metrics.viewportX;
            const auto xStart = originX + juceTextXForByteIndex(text, start, layout.metrics.fontSize);
            const auto xEnd = originX + juceTextXForByteIndex(text, end, layout.metrics.fontSize);
            bounds.add(::juce::Rectangle<int>(
                static_cast<int>(std::round(xStart)),
                static_cast<int>(std::round(layout.metrics.textTop)),
                std::max(1, static_cast<int>(std::round(xEnd - xStart))),
                static_cast<int>(std::round(layout.metrics.lineHeight))));
            return bounds;
        }

        if (start == end) {
            const auto rect = textLayoutService_.caretRect(layout.text, start, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop});
            bounds.add(::juce::Rectangle<int>(
                static_cast<int>(std::round(rect.x)),
                static_cast<int>(std::round(rect.y)),
                1,
                static_cast<int>(std::round(rect.height))));
            return bounds;
        }

        for (const auto& rect : textLayoutService_.boundsForRange(layout.text, start, end, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop})) {
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

        const auto textWidth = juceTextWidth(text, metrics.fontSize);
        const auto caretX = juceTextXForByteIndex(text, cursorIndex, metrics.fontSize);
        const auto margin = 3.0f;
        if (caretX - viewportX > metrics.textWidth - margin) viewportX = caretX - metrics.textWidth + margin;
        if (caretX - viewportX < margin) viewportX = caretX - margin;
        return std::clamp(viewportX, 0.0f, std::max(0.0f, textWidth - metrics.textWidth + margin));
    }

} // namespace arrange::juce

#endif

