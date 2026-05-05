#pragma once

#include <arrange/core/TextLayoutService.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    std::size_t nextUtf8Boundary(const std::string& text, std::size_t cursor);
    std::size_t byteIndexForCharIndex(const std::string& text, int charIndex);
    int charIndexForByteIndex(const std::string& text, std::size_t byteIndex);
    int totalUtf8Chars(const std::string& text);

    float juceTextWidth(std::string_view utf8Text, float fontSize);
    float juceTextXForByteIndex(const std::string& text, std::size_t index, float fontSize);
    std::size_t juceByteIndexAtSingleLineX(const std::string& text, float x, float fontSize);

    class JuceTextMeasurer final : public arrange::core::TextMeasurer {
    public:
        float advance(std::string_view utf8Cluster, char32_t codepoint, const arrange::core::TextStyle& style) const override;
        float lineWidth(std::string_view utf8Text, const arrange::core::TextStyle& style) const override;
        std::optional<arrange::core::Size> measure(std::string_view utf8Text, arrange::core::TextStyle style, arrange::core::TextLayoutOptions options) const override;
    };

#endif
} // namespace arrange::juce
