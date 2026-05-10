#include <arrange/juce/JuceTextServices.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <string>

namespace arrange::juce {
    namespace {
        bool isUtf8Continuation(unsigned char ch) { return (ch & 0xc0u) == 0x80u; }
    } // namespace

    std::size_t nextUtf8Boundary(const std::string& text, std::size_t cursor) {
        if (cursor >= text.size()) return text.size();
        auto pos = cursor + 1;
        while (pos < text.size() && isUtf8Continuation(static_cast<unsigned char>(text[pos]))) ++pos;
        return pos;
    }

    std::size_t byteIndexForCharIndex(const std::string& text, int charIndex) {
        if (charIndex <= 0) return 0;
        std::size_t byteIndex = 0;
        for (int index = 0; index < charIndex && byteIndex < text.size(); ++index) { byteIndex = nextUtf8Boundary(text, byteIndex); }
        return byteIndex;
    }

    int charIndexForByteIndex(const std::string& text, std::size_t byteIndex) {
        const auto target = std::min(byteIndex, text.size());
        int charIndex = 0;
        for (std::size_t pos = 0; pos < target; pos = nextUtf8Boundary(text, pos)) { ++charIndex; }
        return charIndex;
    }

    int totalUtf8Chars(const std::string& text) { return charIndexForByteIndex(text, text.size()); }

    float JuceTextMeasurer::advance(std::string_view utf8Cluster, char32_t, const arrange::core::TextStyle& style) const {
        const auto fontSize = style.fontSize > 0.0f ? style.fontSize : 14.0f;
        const auto text = ::juce::String::fromUTF8(utf8Cluster.data(), static_cast<int>(utf8Cluster.size()));
        const auto font = ::juce::Font(::juce::FontOptions(fontSize));
        return ::juce::GlyphArrangement::getStringWidth(font, text);
    }

    float JuceTextMeasurer::lineWidth(std::string_view utf8Text, const arrange::core::TextStyle& style) const {
        if (utf8Text.empty()) return 0.0f;
        const auto fontSize = style.fontSize > 0.0f ? style.fontSize : 14.0f;
        const auto text = ::juce::String::fromUTF8(utf8Text.data(), static_cast<int>(utf8Text.size()));
        const auto font = ::juce::Font(::juce::FontOptions(fontSize));
        return ::juce::GlyphArrangement::getStringWidth(font, text);
    }

    std::optional<arrange::core::Size> JuceTextMeasurer::measure(std::string_view utf8Text, arrange::core::TextStyle style, arrange::core::TextLayoutOptions options) const {
        const auto fontSize = style.fontSize > 0.0f ? style.fontSize : 14.0f;
        const auto lineHeight = std::max(fontSize, style.lineHeight > 0.0f ? style.lineHeight : fontSize * 1.2f);
        const auto font = ::juce::Font(::juce::FontOptions(fontSize));

        if (options.singleLine || options.maxLines == 1) {
            const auto newline = utf8Text.find('\n');
            const auto line = newline == std::string_view::npos ? utf8Text : utf8Text.substr(0, newline);
            return arrange::core::Size{lineWidth(line, style), lineHeight};
        }

        if (!(options.maxWidth > 0.0f)) {
            auto width = 0.0f;
            auto lines = 0;
            for (std::size_t start = 0; start <= utf8Text.size();) {
                const auto newline = utf8Text.find('\n', start);
                const auto end = newline == std::string_view::npos ? utf8Text.size() : newline;
                if (options.maxLines > 0 && lines >= options.maxLines) break;
                width = std::max(width, lineWidth(utf8Text.substr(start, end - start), style));
                ++lines;
                if (newline == std::string_view::npos) break;
                start = newline + 1;
            }
            return arrange::core::Size{width, lineHeight * static_cast<float>(std::max(1, lines))};
        }

        ::juce::AttributedString attributed;
        const auto text = utf8Text.empty() ? ::juce::String{} : ::juce::String::fromUTF8(utf8Text.data(), static_cast<int>(utf8Text.size()));
        attributed.append(text, font, ::juce::Colours::white);
        attributed.setJustification(::juce::Justification::topLeft);
        attributed.setWordWrap(::juce::AttributedString::byWord);
        attributed.setLineSpacing(std::max(0.0f, lineHeight - font.getHeight()));

        ::juce::TextLayout layout;
        const auto maxHeight = options.maxLines > 0 ? lineHeight * static_cast<float>(options.maxLines) : 1000000.0f;
        layout.createLayout(attributed, std::max(1.0f, options.maxWidth), std::max(1.0f, maxHeight));
        return arrange::core::Size{layout.getWidth(), std::max(lineHeight, layout.getHeight())};
    }

    float juceTextWidth(std::string_view utf8Text, float fontSize) {
        if (utf8Text.empty()) return 0.0f;
        const auto text = ::juce::String::fromUTF8(utf8Text.data(), static_cast<int>(utf8Text.size()));
        const auto font = ::juce::Font(::juce::FontOptions(fontSize > 0.0f ? fontSize : 14.0f));
        return ::juce::GlyphArrangement::getStringWidth(font, text);
    }

    float juceTextXForByteIndex(const std::string& text, std::size_t index, float fontSize) {
        const auto clamped = std::min(index, text.size());
        return clamped == 0 ? 0.0f : juceTextWidth(std::string_view(text.data(), clamped), fontSize);
    }

    std::size_t juceByteIndexAtSingleLineX(const std::string& text, float x, float fontSize) {
        if (text.empty() || x <= 0.0f) return 0;

        auto previousIndex = std::size_t{0};
        auto previousX = 0.0f;
        for (auto nextIndex = nextUtf8Boundary(text, 0); previousIndex < text.size(); nextIndex = nextUtf8Boundary(text, nextIndex)) {
            const auto nextX = juceTextXForByteIndex(text, nextIndex, fontSize);
            if (x < previousX + (nextX - previousX) * 0.5f) return previousIndex;
            previousIndex = nextIndex;
            previousX = nextX;
            if (previousIndex >= text.size()) break;
        }
        return text.size();
    }
} // namespace arrange::juce

#endif
