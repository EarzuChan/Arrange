#pragma once

#include "Geometry.h"

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace arrange::core {
    struct TextStyle {
        float fontSize = 14.0f;
        float lineHeight = 0.0f;
    };

    struct TextLayoutOptions {
        int maxLines = 0;
        float maxWidth = 0.0f;
        bool singleLine = false;
    };

    struct TextRunLayout {
        std::size_t start = 0;
        std::size_t end = 0;
        float x = 0.0f;
        float width = 0.0f;
    };

    struct TextLineLayout {
        std::size_t start = 0;
        std::size_t end = 0;
        float y = 0.0f;
        float width = 0.0f;
        std::vector<TextRunLayout> runs;
    };

    struct TextLayout {
        std::string text;
        TextStyle style;
        TextLayoutOptions options;
        float lineHeight = 16.8f;
        float width = 0.0f;
        float height = 0.0f;
        std::vector<TextLineLayout> lines;
    };

    class TextMeasurer {
    public:
        virtual ~TextMeasurer() = default;
        virtual float advance(std::string_view utf8Cluster, char32_t codepoint, const TextStyle& style) const = 0;
        virtual float lineWidth(std::string_view utf8Text, const TextStyle& style) const;
        virtual std::optional<Size> measure(std::string_view text, TextStyle style, TextLayoutOptions options) const;
    };

    class ApproximateTextMeasurer final : public TextMeasurer {
    public:
        float advance(std::string_view utf8Cluster, char32_t codepoint, const TextStyle& style) const override;
    };

    class TextLayoutService {
    public:
        explicit TextLayoutService(const TextMeasurer& measurer);

        TextLayout layout(std::string_view text, TextStyle style = {}, TextLayoutOptions options = {}) const;
        Size measure(std::string_view text, TextStyle style = {}, TextLayoutOptions options = {}) const;
        float xForByteIndex(const TextLayout& layout, std::size_t index) const;
        std::size_t byteIndexAtPoint(const TextLayout& layout, Point point) const;
        Rect caretRect(const TextLayout& layout, std::size_t index, Point origin = {}) const;
        std::vector<Rect> boundsForRange(const TextLayout& layout, std::size_t start, std::size_t end, Point origin = {}) const;

    private:
        const TextLineLayout& lineForByteIndex(const TextLayout& layout, std::size_t index) const;

        const TextMeasurer& measurer_;
    };

    const TextLayoutService& defaultTextLayoutService();
} // namespace arrange::core
