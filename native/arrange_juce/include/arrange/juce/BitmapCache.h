#pragma once

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_graphics/juce_graphics.h>

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <list>
#include <memory>

namespace arrange::juce {
    struct BitmapCacheCounters {
        std::uint64_t hits = 0;
        std::uint64_t builds = 0;
        std::uint64_t evictions = 0;
        std::size_t retainedBytes = 0;
        std::size_t entries = 0;
    };

    // 重放层的离屏位图缓存：键为不可变片段或资源的身份加参数摘要，按最近使用淘汰，保留字节不超过预算
    class BitmapCache {
       public:
        struct Key {
            // 持有身份对象，保证缓存期间地址不被复用
            std::shared_ptr<const void> owner;
            std::uint64_t detail = 0;
            int width = 0;
            int height = 0;

            bool operator==(const Key& other) const noexcept {
                return owner == other.owner && detail == other.detail && width == other.width && height == other.height;
            }
        };

        explicit BitmapCache(std::size_t budgetBytes = 64u * 1024u * 1024u) noexcept : budget_(budgetBytes) {}

        template <class Build>
        ::juce::Image get(const Key& key, Build&& build) {
            for (auto it = entries_.begin(); it != entries_.end(); ++it)
                if (it->key == key) {
                    entries_.splice(entries_.begin(), entries_, it);
                    ++counters_.hits;
                    return entries_.front().image;
                }
            auto image = build();
            ++counters_.builds;
            const auto bytes = imageBytes(image);
            // 超过整个预算的位图只用一次，不进缓存
            if (bytes > budget_) return image;
            entries_.push_front({key, image, bytes});
            counters_.retainedBytes += bytes;
            trim();
            return image;
        }

        void setBudget(std::size_t bytes) {
            budget_ = bytes;
            trim();
        }

        void clear() noexcept {
            entries_.clear();
            counters_.retainedBytes = 0;
        }

        [[nodiscard]] BitmapCacheCounters counters() const noexcept {
            auto result = counters_;
            result.entries = entries_.size();
            return result;
        }

        static std::size_t imageBytes(const ::juce::Image& image) noexcept {
            return image.isValid() ? static_cast<std::size_t>(image.getWidth()) * static_cast<std::size_t>(image.getHeight()) * 4u : 0u;
        }

       private:
        struct Entry {
            Key key;
            ::juce::Image image;
            std::size_t bytes = 0;
        };

        void trim() {
            while (counters_.retainedBytes > budget_ && !entries_.empty()) {
                counters_.retainedBytes -= entries_.back().bytes;
                entries_.pop_back();
                ++counters_.evictions;
            }
        }

        std::size_t budget_;
        std::list<Entry> entries_;
        BitmapCacheCounters counters_;
    };

    // 参数摘要：逐个混入数值的位模式
    class CacheDetail {
       public:
        template <class T>
        CacheDetail& add(T value) noexcept {
            std::uint64_t bits = 0;
            static_assert(sizeof(T) <= sizeof(bits));
            std::memcpy(&bits, &value, sizeof(T));
            hash_ = (hash_ ^ bits) * 0x100000001b3ull;
            hash_ ^= hash_ >> 29;
            return *this;
        }

        [[nodiscard]] std::uint64_t value() const noexcept {
            return hash_;
        }

       private:
        std::uint64_t hash_ = 0xcbf29ce484222325ull;
    };

    // 预乘 ARGB 的近似高斯模糊：三次可分离盒式模糊，图像外视为透明
    void gaussianBlur(::juce::Image& image, float sigma);
}
#endif
