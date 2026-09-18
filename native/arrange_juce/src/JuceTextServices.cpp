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

    std::size_t JuceTextResource::estimatedBytes() const noexcept {
        auto bytes = sizeof(JuceTextResource) + runs.capacity() * sizeof(Run);
        for (const auto& run : runs) bytes += run.glyphs.capacity() * sizeof(std::uint16_t) + run.positions.capacity() * sizeof(::juce::Point<float>);
        return bytes;
    }

    void JuceTextResource::replay(::juce::Graphics& graphics, const arrange::core::TextLayout& layout, arrange::core::Rect area, const std::string& alignment, float viewportX) const {
        auto& context = graphics.getInternalContext();
        for (const auto& run : runs) {
            const auto width = layout.lines[run.line].width;
            auto x = area.x - viewportX;
            if (alignment == "center" || alignment == "Center") x += (area.width - width) * 0.5f;
            else if (alignment == "right" || alignment == "end" || alignment == "End") x += area.width - width;
            context.setFont(run.font);
            context.drawGlyphs({run.glyphs.data(), run.glyphs.size()}, {run.positions.data(), run.positions.size()}, ::juce::AffineTransform::translation(x, area.y));
        }
    }

    arrange::core::TextLayout JuceTextMeasurer::createLayout(std::string_view source, arrange::core::TextStyle style, arrange::core::TextLayoutOptions options) const {
        arrange::core::TextLayout result;
        result.lineHeight = style.lineHeight;
        auto resource = std::make_shared<JuceTextResource>();
        result.resource = resource;
        const auto font = ::juce::Font(::juce::FontOptions(style.fontSize));
        result.baseline = font.getAscent() + std::max(0.0f, (style.lineHeight - font.getHeight()) * 0.5f);
        auto text = ::juce::String::fromUTF8(source.data(), static_cast<int>(source.size()));
        if (options.singleLine) text = text.upToFirstOccurrenceOf("\n", false, false);

        // JUCE 固定版本的 shaping 接口同时提供 fallback 字体、簇几何和省略后的字形
        auto settings = ::juce::detail::ShapedText::Options{}.withFont(font).withBaselineAtZero(false).withAdditiveLineSpacing(std::max(0.0f, style.lineHeight - font.getHeight())).withDrawLinesInFull(!options.ellipsis);
        if (options.maxLines > 0) settings = settings.withMaxNumLines(options.maxLines);
        if (options.maxWidth > 0 && (!options.singleLine || options.ellipsis)) settings = settings.withWordWrapWidth(options.maxWidth);
        if (options.ellipsis) settings = settings.withEllipsis();
        const ::juce::detail::ShapedText shaped(text, settings);
        std::vector<std::size_t> byteOffsets{0};
        const auto utf8 = text.toStdString();
        for (std::size_t offset = 0; offset < utf8.size();) {
            offset = nextUtf8Boundary(utf8, offset);
            byteOffsets.push_back(offset);
        }
        const auto byteAt = [&](::juce::int64 index) { return byteOffsets[static_cast<std::size_t>(std::clamp<::juce::int64>(index, 0, static_cast<::juce::int64>(byteOffsets.size() - 1)))]; };
        ::juce::Rectangle<float> ink;
        bool hasInk = false;
        shaped.accessTogetherWith([&](auto glyphs, const auto& positions, ::juce::Font resolvedFont, auto glyphRange, auto metrics) {
            const auto lineIndex = static_cast<std::size_t>(metrics.lineNumber);
            if (result.lines.size() <= lineIndex) result.lines.resize(lineIndex + 1);
            auto& line = result.lines[lineIndex];
            line.y = metrics.top;
            line.height = metrics.nextLineTop - metrics.top;
            line.baseline = metrics.anchor.y;
            if (lineIndex == 0) result.baseline = metrics.anchor.y;
            result.height = std::max(result.height, metrics.nextLineTop);

            JuceTextResource::Run run;
            run.font = resolvedFont;
            run.line = lineIndex;
            run.glyphs.reserve(glyphs.size());
            run.positions.reserve(glyphs.size());
            const auto typeface = resolvedFont.getTypefacePtr();
            for (std::size_t i = 0; i < glyphs.size(); ++i) {
                const auto& glyph = glyphs[i];
                if (!glyph.isNewline() && !glyph.isPlaceholderForLigature()) {
                    run.glyphs.push_back(static_cast<std::uint16_t>(glyph.glyphId));
                    run.positions.push_back(positions[i]);
                    if (typeface) {
                        const auto bounds = typeface->getGlyphBounds(resolvedFont.getMetricsKind(), static_cast<int>(glyph.glyphId)).transformedBy(::juce::AffineTransform::scale(resolvedFont.getHeight() * resolvedFont.getHorizontalScale(), resolvedFont.getHeight())).translated(positions[i].x, positions[i].y);
                        if (!bounds.isEmpty()) { ink = hasInk ? ink.getUnion(bounds) : bounds; hasInk = true; }
                    } else result.boundsKnown = false;
                }

                // 输入几何保留占位字形分摊的前进量，使用笔位置而非带字形偏移的墨迹位置
                const auto penX = positions[i].x - glyph.offset.x;
                if (!glyph.isNewline()) line.width = std::max(line.width, penX + glyph.advance.x);
                const auto index = glyphRange.getStart() + static_cast<::juce::int64>(i);
                if (index < shaped.getNumGlyphs()) {
                    const auto range = shaped.getTextRange(index);
                    const auto start = byteAt(range.getStart());
                    const auto end = glyph.isNewline() ? start : byteAt(range.getEnd());
                    if (line.runs.empty()) line.start = start;
                    line.start = std::min(line.start, start);
                    line.end = std::max(line.end, end);
                    if (!glyph.isNewline()) line.runs.push_back({start, end, penX, glyph.advance.x});
                }
            }
            if (!run.glyphs.empty()) resource->runs.push_back(std::move(run));
        });
        for (auto& line : result.lines) {
            // 一个字符区间可能对应多个字形，合并其前进范围后再建立视觉顺序
            std::stable_sort(line.runs.begin(), line.runs.end(), [](const auto& left, const auto& right) { return left.start != right.start ? left.start < right.start : left.end < right.end; });
            std::size_t count = 0;
            for (const auto current : line.runs) {
                if (count > 0 && line.runs[count - 1].start == current.start && line.runs[count - 1].end == current.end) {
                    auto& previous = line.runs[count - 1];
                    const auto right = std::max(previous.x + previous.width, current.x + current.width);
                    previous.x = std::min(previous.x, current.x);
                    previous.width = right - previous.x;
                } else line.runs[count++] = current;
            }
            line.runs.resize(count);
            std::stable_sort(line.runs.begin(), line.runs.end(), [](const auto& left, const auto& right) { return left.x < right.x; });
            result.width = std::max(result.width, line.width);
        }
        if (result.lines.empty()) result.lines.push_back({});
        if (!options.singleLine && !source.empty() && source.back() == '\n' && (options.maxLines == 0 || result.lines.size() < static_cast<std::size_t>(options.maxLines))) {
            arrange::core::TextLineLayout trailing;
            trailing.start = trailing.end = source.size();
            trailing.y = result.height;
            trailing.height = style.lineHeight;
            trailing.baseline = trailing.y + result.baseline;
            result.lines.push_back(trailing);
            result.height += style.lineHeight;
        }
        result.height = std::max(style.lineHeight, result.height);
        if (hasInk) result.inkBounds = {ink.getX(), ink.getY(), ink.getWidth(), ink.getHeight()};
        result.truncated = result.lines.back().end < source.size();
        return result;
    }
} // namespace arrange::juce

#endif
