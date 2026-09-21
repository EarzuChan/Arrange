#include <arrange/core/TextLayoutService.h>
#include <arrange/core/TextMetrics.h>

#include <algorithm>
#include <cmath>
#include <chrono>
#include <stdexcept>

namespace arrange::core {
    namespace {
        float effectiveLineHeight(TextStyle style) noexcept {
            const auto fontSize = style.fontSize > 0.0f ? style.fontSize : 14.0f;
            return std::max(fontSize, style.lineHeight > 0.0f ? style.lineHeight : fontSize * 1.2f);
        }

        float xInLine(const TextLineLayout& line, std::size_t index) {
            if (index <= line.start) return 0.0f;
            if (index >= line.end) return line.width;
            for (const auto& run : line.runs) {
                if (index < run.end) return run.x;
                if (index == run.end) return run.x + run.width;
            }
            return line.width;
        }
    }  // namespace

    float ApproximateTextMeasurer::advance(std::string_view, char32_t codepoint, const TextStyle& style) const {
        return textCodepointAdvance(codepoint, style.fontSize > 0.0f ? style.fontSize : 14.0f);
    }

    TextLayoutService::TextLayoutService(const TextMeasurer& measurer, std::size_t maxEntries, std::size_t maxBytes) : measurer_(measurer), maxEntries_(maxEntries), maxBytes_(maxBytes) {}

    float ApproximateTextMeasurer::lineWidth(std::string_view source, const TextStyle& style) const {
        float width = 0.0f;
        for (std::size_t byteIndex = 0; byteIndex < source.size();) {
            const auto runStart = byteIndex;
            const auto codepoint = decodeUtf8Codepoint(source, byteIndex);
            if (codepoint == U'\n') break;
            width += advance(source.substr(runStart, byteIndex - runStart), codepoint, style);
        }
        return width;
    }

    TextLayout ApproximateTextMeasurer::createLayout(std::string_view source, TextStyle style, TextLayoutOptions options) const {
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

        auto settleLineWidth = [&](TextLineLayout& target) {
            target.width = target.end > target.start ? lineWidth(source.substr(target.start, target.end - target.start), style) : 0.0f;
        };

        auto finishLine = [&](std::size_t nextStart) {
            settleLineWidth(line);
            result.width = std::max(result.width, line.width);
            result.lines.push_back(std::move(line));
            line = {};
            line.start = nextStart;
            line.end = line.start;
            line.y = static_cast<float>(result.lines.size()) * result.lineHeight;
        };

        auto visibleLineLimitReached = [&] {
            return options.maxLines > 0 && static_cast<int>(result.lines.size()) >= options.maxLines;
        };

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
            const auto width = advance(source.substr(runStart, runEnd - runStart), codepoint, style);
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
        if (result.lines.empty()) {
            result.lines.push_back({});
        }

        result.height = result.lineHeight * static_cast<float>(result.lines.size());
        result.baseline = result.lineHeight * 0.8f;
        result.inkBounds = {0, 0, result.width, result.height};
        return result;
    }

    std::size_t TextLayoutService::KeyHash::operator()(const Key& key) const noexcept {
        auto hash = std::hash<std::string>{}(key.text);
        const auto mix = [&](std::size_t value) {
            hash ^= value + 0x9e3779b9u + (hash << 6) + (hash >> 2);
        };
        mix(std::hash<float>{}(key.style.fontSize));
        mix(std::hash<float>{}(key.style.lineHeight));
        mix(std::hash<float>{}(key.options.maxWidth));
        mix(std::hash<int>{}(key.options.maxLines));
        mix(key.options.singleLine);
        mix(key.options.ellipsis);
        return hash;
    }

    std::shared_ptr<const TextLayout> TextLayoutService::layout(std::string_view text, TextStyle style, TextLayoutOptions options, const std::shared_ptr<const TextLayout>& previous) const {
        if (!std::isfinite(style.fontSize) || !std::isfinite(style.lineHeight) || !std::isfinite(options.maxWidth)) throw std::invalid_argument("文本排版参数必须是有限数值");
        if (!(style.fontSize > 0)) style.fontSize = 14;
        style.lineHeight = effectiveLineHeight(style);
        options.singleLine = options.singleLine || options.maxLines == 1;
        if (options.singleLine && !options.ellipsis) options.maxWidth = 0;
        auto equivalentOptions = previous && previous->options == options;
        if (previous && !previous->truncated && previous->options.maxLines == options.maxLines && previous->options.singleLine == options.singleLine && previous->options.ellipsis == options.ellipsis) {
            const auto oldWidth = previous->options.maxWidth;
            const auto newWidth = options.maxWidth;
            if (newWidth >= previous->width && ((oldWidth > 0 && newWidth <= oldWidth) || previous->lines.size() == 1)) equivalentOptions = true;
        }
        if (previous && previous->serviceIdentity == counters_.get() && previous->environment == environment_ && previous->text == text && previous->style == style && equivalentOptions) {
            ++counters_->nodeReuses;
            return previous;
        }

        Key key{std::string(text), style, options};
        if (const auto found = cache_.find(key); found != cache_.end()) {
            ++counters_->cacheHits;
            lru_.splice(lru_.begin(), lru_, found->second);
            return found->second->layout;
        }
        ++counters_->cacheMisses;
        const auto started = std::chrono::steady_clock::now();
        auto result = std::make_unique<TextLayout>(measurer_.createLayout(text, style, options));
        result->text = key.text;
        result->style = style;
        result->options = options;
        result->environment = environment_;
        result->serviceIdentity = counters_.get();
        auto bytes = sizeof(TextLayout) + result->text.capacity() + result->lines.capacity() * sizeof(TextLineLayout);
        for (const auto& line : result->lines) bytes += line.runs.capacity() * sizeof(TextRunLayout);
        if (result->resource) bytes += result->resource->estimatedBytes();
        ++counters_->layoutsCreated;
        ++counters_->liveResources;
        counters_->liveBytes += bytes;
        counters_->layoutMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        std::shared_ptr<const TextLayout> shared(result.release(), [stats = counters_, bytes](const TextLayout* value) {
            delete value;
            --stats->liveResources;
            stats->liveBytes -= bytes;
        });

        const auto retainedBytes = bytes + 2 * key.text.capacity() + sizeof(Entry) + sizeof(Key);
        if (maxEntries_ > 0 && retainedBytes <= maxBytes_) {
            while (!lru_.empty() && (lru_.size() >= maxEntries_ || counters_->cachedBytes + retainedBytes > maxBytes_)) {
                counters_->cachedBytes -= lru_.back().bytes;
                cache_.erase(lru_.back().key);
                lru_.pop_back();
                ++counters_->evictions;
            }
            lru_.push_front({std::move(key), shared, retainedBytes});
            cache_.emplace(lru_.front().key, lru_.begin());
            counters_->cachedBytes += retainedBytes;
            counters_->cachedEntries = lru_.size();
        }
        return shared;
    }

    void TextLayoutService::clearCache() const {
        cache_.clear();
        lru_.clear();
        counters_->cachedBytes = 0;
        counters_->cachedEntries = 0;
    }

    void TextLayoutService::invalidateFontEnvironment() {
        ++environment_;
        clearCache();
    }

    Size TextLayoutService::measure(std::string_view text, TextStyle style, TextLayoutOptions options) const {
        const auto laidOut = layout(text, style, options);
        return {laidOut->width, laidOut->height};
    }

    float TextLayoutService::xForByteIndex(const TextLayout& layout, std::size_t index) const {
        return xInLine(lineForByteIndex(layout, index), std::min(index, layout.text.size()));
    }

    std::size_t TextLayoutService::byteIndexAtPoint(const TextLayout& layout, Point point) const {
        if (layout.lines.empty()) return 0;
        auto lineIndex = std::size_t{0};
        while (lineIndex + 1 < layout.lines.size() && point.y >= layout.lines[lineIndex + 1].y) ++lineIndex;
        const auto& line = layout.lines[lineIndex];
        const auto localX = std::max(0.0f, point.x);
        for (const auto& run : line.runs) {
            if (localX < run.x + run.width * 0.5f) return run.start;
        }
        return line.end;
    }

    Rect TextLayoutService::caretRect(const TextLayout& layout, std::size_t index, Point origin) const {
        const auto& line = lineForByteIndex(layout, index);
        return {origin.x + xInLine(line, std::min(index, layout.text.size())), origin.y + line.y, 1.0f, line.height > 0 ? line.height : layout.lineHeight};
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
            const auto xStart = xInLine(line, selectedStart);
            const auto xEnd = xInLine(line, selectedEnd);
            bounds.push_back({origin.x + xStart, origin.y + line.y, std::max(1.0f, xEnd - xStart), line.height > 0 ? line.height : layout.lineHeight});
        }
        return bounds;
    }

    const TextLineLayout& TextLayoutService::lineForByteIndex(const TextLayout& layout, std::size_t index) const {
        const auto clamped = std::min(index, layout.text.size());
        // 自动换行的公共字节位置归下一行；显式换行前的位置仍归上一行
        for (auto line = layout.lines.rbegin(); line != layout.lines.rend(); ++line) {
            if (clamped >= line->start) return *line;
        }
        return layout.lines.front();
    }

    const TextLayoutService& defaultTextLayoutService() {
        static const ApproximateTextMeasurer measurer;
        static const TextLayoutService service(measurer, 0, 0);
        return service;
    }
}  // namespace arrange::core
