#pragma once

#include "Geometry.h"

#include <cstddef>
#include <memory>
#include <list>
#include <unordered_map>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace arrange::core {
    struct TextStyle {
        float fontSize = 14.0f;
        float lineHeight = 0.0f;
        bool operator==(const TextStyle&) const = default;
    };

    struct TextLayoutOptions {
        int maxLines = 0;
        float maxWidth = 0.0f;
        bool singleLine = false;
        bool ellipsis = false;
        bool operator==(const TextLayoutOptions&) const = default;
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
        float height = 0;
        float baseline = 0;
    };

    class TextDrawResource {
    public:
        virtual ~TextDrawResource() = default;
        virtual std::size_t estimatedBytes() const noexcept = 0;
    };

    struct TextLayout {
        std::string text;
        TextStyle style;
        TextLayoutOptions options;
        float lineHeight = 16.8f;
        float width = 0.0f;
        float height = 0.0f;
        std::vector<TextLineLayout> lines;
        std::uint64_t environment = 0;
        const void* serviceIdentity = nullptr;
        float baseline = 0.0f;
        Rect inkBounds;
        bool boundsKnown = true;
        bool truncated = false;
        std::shared_ptr<const TextDrawResource> resource;
    };

    class TextMeasurer {
    public:
        virtual ~TextMeasurer() = default;
        virtual TextLayout createLayout(std::string_view text, TextStyle style, TextLayoutOptions options) const = 0;
    };

    // 无后端的确定性测试实现，不向正式 JUCE paint 提供兼容兜底
    class ApproximateTextMeasurer : public TextMeasurer {
    public:
        TextLayout createLayout(std::string_view text, TextStyle style, TextLayoutOptions options) const override;

    protected:
        virtual float advance(std::string_view utf8Cluster, char32_t codepoint, const TextStyle& style) const;
        float lineWidth(std::string_view utf8Text, const TextStyle& style) const;
    };

    struct TextLayoutCounters {
        std::uint64_t layoutsCreated = 0;
        std::uint64_t nodeReuses = 0;
        std::uint64_t cacheHits = 0;
        std::uint64_t cacheMisses = 0;
        std::uint64_t evictions = 0;
        std::size_t cachedBytes = 0;
        std::size_t cachedEntries = 0;
        std::size_t liveBytes = 0;
        std::size_t liveResources = 0;
        double layoutMillis = 0;
    };

    class TextLayoutService {
    public:
        explicit TextLayoutService(const TextMeasurer& measurer, std::size_t maxEntries = 256, std::size_t maxBytes = 8 * 1024 * 1024);
        TextLayoutService(const TextLayoutService&) = delete;
        TextLayoutService& operator=(const TextLayoutService&) = delete;

        std::shared_ptr<const TextLayout> layout(std::string_view text, TextStyle style = {}, TextLayoutOptions options = {}, const std::shared_ptr<const TextLayout>& previous = {}) const;
        void invalidateFontEnvironment();
        void clearCache() const;
        TextLayoutCounters counters() const noexcept { return *counters_; }
        Size measure(std::string_view text, TextStyle style = {}, TextLayoutOptions options = {}) const;
        float xForByteIndex(const TextLayout& layout, std::size_t index) const;
        std::size_t byteIndexAtPoint(const TextLayout& layout, Point point) const;
        Rect caretRect(const TextLayout& layout, std::size_t index, Point origin = {}) const;
        std::vector<Rect> boundsForRange(const TextLayout& layout, std::size_t start, std::size_t end, Point origin = {}) const;

    private:
        const TextLineLayout& lineForByteIndex(const TextLayout& layout, std::size_t index) const;

        struct Key {
            std::string text;
            TextStyle style;
            TextLayoutOptions options;
            bool operator==(const Key&) const = default;
        };
        struct KeyHash { std::size_t operator()(const Key& key) const noexcept; };
        struct Entry {
            Key key;
            std::shared_ptr<const TextLayout> layout;
            std::size_t bytes = 0;
        };

        const TextMeasurer& measurer_;
        std::size_t maxEntries_;
        std::size_t maxBytes_;
        mutable std::list<Entry> lru_;
        mutable std::unordered_map<Key, std::list<Entry>::iterator, KeyHash> cache_;
        std::shared_ptr<TextLayoutCounters> counters_ = std::make_shared<TextLayoutCounters>();
        std::uint64_t environment_ = 1;
    };

    const TextLayoutService& defaultTextLayoutService();
} // namespace arrange::core
