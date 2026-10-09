#include <arrange/juce/TextInputLayoutModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace arrange::juce {
    namespace {
        enum class WordCharacterClass { Space, Word, Punctuation };

        WordCharacterClass wordCharacterClass(::juce::juce_wchar character) {
            if (::juce::CharacterFunctions::isWhitespace(character) || character == 0x00a0 || character == 0x202f || character == 0x3000 || (character >= 0x2000 && character <= 0x200a)) return WordCharacterClass::Space;
            if (character >= 0xff01 && character <= 0xff5e) character -= 0xfee0;
            if (::juce::CharacterFunctions::isLetterOrDigit(character) || character == '_') return WordCharacterClass::Word;
            // JUCE 的字母分类依赖 locale，非 ASCII 沿用 TextEditor 的补充判定并排除常见标点
            if (character > 128 && !(character >= 0x2000 && character <= 0x206f) && !(character >= 0x2e00 && character <= 0x2e7f) && !(character >= 0x3000 && character <= 0x303f)) return WordCharacterClass::Word;
            return WordCharacterClass::Punctuation;
        }

        arrange::core::TextSelectionRange wordRange(const std::string& text, std::size_t index) {
            if (text.empty()) return {};
            const auto beginning = ::juce::CharPointer_UTF8(text.c_str());
            auto start = ::juce::CharPointer_UTF8(text.c_str() + std::min(index, text.size()));
            if (start.isEmpty()) --start;
            const auto category = wordCharacterClass(*start);
            auto end = start;
            ++end;
            if (*start == '\r' || *start == '\n') return {static_cast<std::size_t>(start.getAddress() - text.c_str()), static_cast<std::size_t>(end.getAddress() - text.c_str())};
            while (start > beginning) {
                auto previous = start;
                --previous;
                if (*previous == '\r' || *previous == '\n' || wordCharacterClass(*previous) != category) break;
                start = previous;
            }
            while (!end.isEmpty() && *end != '\r' && *end != '\n' && wordCharacterClass(*end) == category) ++end;
            return {static_cast<std::size_t>(start.getAddress() - text.c_str()), static_cast<std::size_t>(end.getAddress() - text.c_str())};
        }
    }

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

    arrange::core::TextSelectionRange TextInputLayoutModel::selectionAtPoint(const arrange::core::ModifierInstance& instance, const std::string& text, float viewportX, arrange::core::Point point, float viewportY, arrange::core::TextSelectionGranularity granularity) const {
        using Granularity = arrange::core::TextSelectionGranularity;
        if (granularity == Granularity::All) return {0, text.size()};
        const auto prepared = layout(instance, text, viewportX, viewportY);
        point.x += prepared.metrics.viewportX - prepared.metrics.textLeft;
        point.y += prepared.metrics.viewportY - prepared.metrics.textTop;
        const auto cursor = textLayoutService_.byteIndexAtPoint(*prepared.text, point);
        if (granularity == Granularity::Character) return {cursor, cursor};
        if (prepared.text->lines.empty()) return {};
        auto lineIndex = std::size_t{0};
        while (lineIndex + 1 < prepared.text->lines.size() && point.y >= prepared.text->lines[lineIndex + 1].y) ++lineIndex;
        const auto& line = prepared.text->lines[lineIndex];
        if (granularity == Granularity::VisualLine) return {std::min(line.start, text.size()), std::min(line.end, text.size())};
        auto character = cursor;
        for (const auto& run : line.runs)
            if (point.x >= run.x && point.x < run.x + run.width) {
                character = run.start;
                break;
            }
        if (character == line.end && !line.runs.empty()) character = line.runs.back().start;
        return wordRange(text, character);
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
