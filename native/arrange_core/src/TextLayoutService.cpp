#include <arrange/core/TextLayoutService.h>
#include <arrange/core/TextMetrics.h>

#include <algorithm>
#include <cmath>

namespace arrange::core {
    namespace {
        float effectiveLineHeight(TextStyle style) noexcept {
            const auto fontSize = style.fontSize > 0.0f ? style.fontSize : 14.0f;
            return std::max(fontSize, style.lineHeight > 0.0f ? style.lineHeight : fontSize * 1.2f);
        }
    } // namespace

    float ApproximateTextMeasurer::advance(std::string_view, char32_t codepoint, const TextStyle& style) const { return textCodepointAdvance(codepoint, style.fontSize > 0.0f ? style.fontSize : 14.0f); }

    TextLayoutService::TextLayoutService(const TextMeasurer& measurer) : measurer_(measurer) {}

    float TextMeasurer::lineWidth(std::string_view source, const TextStyle& style) const {
        float width = 0.0f;
        for (std::size_t byteIndex = 0; byteIndex < source.size();) {
            const auto runStart = byteIndex;
            const auto codepoint = decodeUtf8Codepoint(source, byteIndex);
            if (codepoint == U'\n') break;
            width += advance(source.substr(runStart, byteIndex - runStart), codepoint, style);
        }
        return width;
    }

    std::optional<Size> TextMeasurer::measure(std::string_view, TextStyle, TextLayoutOptions) const { return std::nullopt; }

    TextLayout TextLayoutService::layout(std::string_view source, TextStyle style, TextLayoutOptions options) const {
        if (!(style.fontSize > 0.0f)) style.fontSize = 14.0f;

        TextLayout result;
        result.text = std::string(source);
        result.style = style;
        result.options = options;
        result.lineHeight = effectiveLineHeight(style);

        TextLineLayout line;
        line.start = 0;
        line.end = 0;
        line.y = 0.0f;

        auto settleLineWidth = [&](TextLineLayout& target) { target.width = target.end > target.start ? measurer_.lineWidth(source.substr(target.start, target.end - target.start), style) : 0.0f; };

        auto finishLine = [&](std::size_t nextStart) {
            settleLineWidth(line);
            result.width = std::max(result.width, line.width);
            result.lines.push_back(std::move(line));
            line = {};
            line.start = nextStart;
            line.end = line.start;
            line.y = static_cast<float>(result.lines.size()) * result.lineHeight;
        };

        auto visibleLineLimitReached = [&] { return options.maxLines > 0 && static_cast<int>(result.lines.size()) >= options.maxLines; };

        for (std::size_t byteIndex = 0; byteIndex < source.size();) {
            const auto runStart = byteIndex;
            const auto codepoint = decodeUtf8Codepoint(source, byteIndex);
            if (!options.singleLine && codepoint == U'\n') {
                line.end = runStart;
                finishLine(byteIndex);
                if (visibleLineLimitReached()) break;
                continue;
            }
            if (options.singleLine && codepoint == U'\n') break;

            const auto runEnd = byteIndex;
            const auto width = measurer_.advance(source.substr(runStart, runEnd - runStart), codepoint, style);
            if (!options.singleLine && options.maxWidth > 0.0f && !line.runs.empty() && line.width + width > options.maxWidth) {
                finishLine(runStart);
                if (visibleLineLimitReached()) break;
            }
            line.runs.push_back({runStart, runEnd, line.width, width});
            line.width += width;
            line.end = runEnd;
        }

        if (!visibleLineLimitReached()) {
            line.end = std::min(line.end, source.size());
            settleLineWidth(line);
            result.width = std::max(result.width, line.width);
            result.lines.push_back(std::move(line));
        }
        if (result.lines.empty()) { result.lines.push_back({}); }

        result.height = result.lineHeight * static_cast<float>(result.lines.size());
        return result;
    }

    Size TextLayoutService::measure(std::string_view text, TextStyle style, TextLayoutOptions options) const {
        if (auto measured = measurer_.measure(text, style, options)) return *measured;
        const auto laidOut = layout(text, style, options);
        return {laidOut.width, laidOut.height};
    }

    float TextLayoutService::xForByteIndex(const TextLayout& layout, std::size_t index) const {
        const auto& line = lineForByteIndex(layout, index);
        const auto clamped = std::min(index, layout.text.size());
        if (clamped <= line.start) return 0.0f;
        if (clamped >= line.end) return line.width;
        for (const auto& run : line.runs) {
            if (clamped <= run.start) return run.x;
            if (clamped < run.end) return run.x;
            if (clamped == run.end) return run.x + run.width;
        }
        return line.width;
    }

    std::size_t TextLayoutService::byteIndexAtPoint(const TextLayout& layout, Point point) const {
        if (layout.lines.empty()) return 0;
        const auto rawLine = static_cast<int>(std::floor(point.y / std::max(1.0f, layout.lineHeight)));
        const auto lineIndex = std::clamp(rawLine, 0, static_cast<int>(layout.lines.size()) - 1);
        const auto& line = layout.lines[static_cast<std::size_t>(lineIndex)];
        const auto localX = std::max(0.0f, point.x);
        for (const auto& run : line.runs) { if (localX < run.x + run.width * 0.5f) return run.start; }
        return line.end;
    }

    Rect TextLayoutService::caretRect(const TextLayout& layout, std::size_t index, Point origin) const {
        const auto& line = lineForByteIndex(layout, index);
        return {origin.x + xForByteIndex(layout, index), origin.y + line.y, 1.0f, layout.lineHeight};
    }

    std::vector<Rect> TextLayoutService::boundsForRange(const TextLayout& layout, std::size_t start, std::size_t end, Point origin) const {
        std::vector<Rect> bounds;
        start = std::min(start, layout.text.size());
        end = std::min(end, layout.text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            bounds.push_back(caretRect(layout, start, origin));
            return bounds;
        }

        for (const auto& line : layout.lines) {
            const auto selectedStart = std::max(start, line.start);
            const auto selectedEnd = std::min(end, line.end);
            if (selectedStart >= selectedEnd) continue;
            const auto xStart = xForByteIndex(layout, selectedStart);
            const auto xEnd = xForByteIndex(layout, selectedEnd);
            bounds.push_back({origin.x + xStart, origin.y + line.y, std::max(1.0f, xEnd - xStart), layout.lineHeight});
        }
        return bounds;
    }

    const TextLineLayout& TextLayoutService::lineForByteIndex(const TextLayout& layout, std::size_t index) const {
        const auto clamped = std::min(index, layout.text.size());
        for (const auto& line : layout.lines) { if (clamped >= line.start && clamped <= line.end) return line; }
        return layout.lines.back();
    }

    const TextLayoutService& defaultTextLayoutService() {
        static const ApproximateTextMeasurer measurer;
        static const TextLayoutService service(measurer);
        return service;
    }
} // namespace arrange::core
