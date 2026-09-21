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

    class JuceTextResource final : public arrange::core::TextDrawResource {
       public:
        struct Run {
            ::juce::Font font{::juce::FontOptions{}};
            std::vector<std::uint16_t> glyphs;
            std::vector<::juce::Point<float>> positions;
            std::size_t line = 0;
        };

        std::vector<Run> runs;
        std::size_t estimatedBytes() const noexcept override;
        void replay(::juce::Graphics& graphics, const arrange::core::TextLayout& layout, arrange::core::Rect area, const std::string& alignment, float viewportX) const;
    };

    class JuceTextMeasurer final : public arrange::core::TextMeasurer {
       public:
        arrange::core::TextLayout createLayout(std::string_view utf8Text, arrange::core::TextStyle style, arrange::core::TextLayoutOptions options) const override;
    };

#endif
}  // namespace arrange::juce
