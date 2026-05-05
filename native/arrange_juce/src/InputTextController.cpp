#include <arrange/juce/InputTextController.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace arrange::juce {
    namespace {
        std::string nodeProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr) {
            if (const auto it = node.props.find(camelCase); it != node.props.end()) return it->second;
            if (kebabCase != nullptr) { if (const auto it = node.props.find(kebabCase); it != node.props.end()) return it->second; }
            return {};
        }

        bool boolProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr, bool fallback = false) {
            auto value = nodeProp(node, camelCase, kebabCase);
            return value.empty() ? fallback : arrange::core::EncodedProp(value).boolValue(fallback);
        }

        float numberProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr, float fallback = 0.0f) {
            auto value = nodeProp(node, camelCase, kebabCase);
            return value.empty() ? fallback : arrange::core::EncodedProp(value).floatValue(fallback);
        }
    } // namespace

    InputTextController::InputTextController(arrange::core::TextLayoutService& textLayoutService) noexcept
        : textLayoutService_(textLayoutService) {}

    bool InputTextController::allowsLineBreak(const arrange::core::ArrangeNode& node) {
        if (!boolProp(node, "singleLine", "single-line", true)) return true;
        if (numberProp(node, "minLines", "min-lines", 1.0f) > 1.0f) return true;
        if (numberProp(node, "maxLines", "max-lines", 1.0f) > 1.0f) return true;
        return false;
    }

    InputTextController::Metrics InputTextController::metrics(const arrange::core::ArrangeNode& node, float viewportX) const {
        Metrics metrics;
        metrics.rect = ::juce::Rectangle<float>(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
        const auto style = arrange::core::objectFromEncodedProp(arrange::core::EncodedProp(nodeProp(node, "textStyle", "text-style")));
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

    InputTextController::Layout InputTextController::layout(const arrange::core::ArrangeNode& node, const std::string& text, float viewportX) const {
        Layout layout;
        layout.metrics = metrics(node, viewportX);
        layout.text = textLayoutService_.layout(
            text,
            {layout.metrics.fontSize, layout.metrics.lineHeight},
            {layout.metrics.singleLine ? 1 : 0, layout.metrics.singleLine ? 0.0f : layout.metrics.textWidth, layout.metrics.singleLine});
        return layout;
    }

    const arrange::core::TextLineLayout& InputTextController::lineForByteIndex(const Layout& layout, std::size_t index) const {
        const auto clamped = std::min(index, layout.text.text.size());
        for (const auto& line : layout.text.lines) { if (clamped >= line.start && clamped <= line.end) return line; }
        return layout.text.lines.back();
    }

    float InputTextController::xForByteIndex(const Layout& layout, const std::string& text, std::size_t index) const {
        if (layout.metrics.singleLine) { return layout.metrics.textLeft - layout.metrics.viewportX + juceTextXForByteIndex(text, index, layout.metrics.fontSize); }
        return layout.metrics.textLeft - layout.metrics.viewportX + textLayoutService_.xForByteIndex(layout.text, index);
    }

    std::size_t InputTextController::textIndexAtPoint(
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

    ::juce::RectangleList<int> InputTextController::textBoundsForByteRange(
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

    float InputTextController::updatedViewportX(const arrange::core::ArrangeNode& node, const std::string& text, std::size_t cursorIndex, float viewportX) const {
        const auto metrics = this->metrics(node, viewportX);
        if (!metrics.singleLine) return 0.0f;

        const auto textWidth = juceTextWidth(text, metrics.fontSize);
        const auto caretX = juceTextXForByteIndex(text, cursorIndex, metrics.fontSize);
        const auto margin = 3.0f;
        if (caretX - viewportX > metrics.textWidth - margin) viewportX = caretX - metrics.textWidth + margin;
        if (caretX - viewportX < margin) viewportX = caretX - margin;
        return std::clamp(viewportX, 0.0f, std::max(0.0f, textWidth - metrics.textWidth + margin));
    }

    void InputTextController::paintFocusedInput(
        ::juce::Graphics& g,
        const arrange::core::ArrangeNode& node,
        const arrange::core::TextInputState& state,
        float viewportX,
        const std::vector<::juce::Range<int>>& temporaryUnderlines) const {
        const auto layout = this->layout(node, state.text(), viewportX);
        const auto& metrics = layout.metrics;
        const auto rect = metrics.rect;
        const auto lineHeight = metrics.lineHeight;
        const auto& text = state.text();

        g.setColour(::juce::Colour(0xff7aa2ff));
        g.drawRect(rect, 1.0f);

        const auto textClip = ::juce::Rectangle<float>(metrics.textLeft, metrics.textTop, metrics.textWidth, metrics.textHeight);
        g.saveState();
        g.reduceClipRegion(textClip.toNearestInt());

        if (state.hasSelection()) {
            const auto start = std::min(state.selectionStart(), state.selectionEnd());
            const auto end = std::max(state.selectionStart(), state.selectionEnd());
            g.setColour(::juce::Colour(0x663a7afe));
            for (const auto& area : textBoundsForByteRange(layout, text, start, end)) { g.fillRect(area.toFloat()); }
        }

        if (!temporaryUnderlines.empty()) {
            g.setColour(::juce::Colour(0xff7aa2ff));
            for (const auto& range : temporaryUnderlines) {
                const auto start = byteIndexForCharIndex(text, range.getStart());
                const auto end = byteIndexForCharIndex(text, range.getEnd());
                for (const auto& area : textBoundsForByteRange(layout, text, start, end)) {
                    const auto underlineY = static_cast<float>(area.getBottom() - 2);
                    g.drawLine(static_cast<float>(area.getX()), underlineY, static_cast<float>(area.getRight()), underlineY, 1.0f);
                }
            }
        }

        const auto cursorX = xForByteIndex(layout, text, state.cursorIndex());
        const auto cursorY = metrics.singleLine
                                 ? metrics.textTop
                                 : std::min(textClip.getBottom() - lineHeight, metrics.textTop + lineForByteIndex(layout, state.cursorIndex()).y);
        g.setColour(::juce::Colour(0xffe8eaed));
        g.drawLine(cursorX, cursorY, cursorX, cursorY + lineHeight, 1.0f);
        g.restoreState();
    }
} // namespace arrange::juce

#endif
