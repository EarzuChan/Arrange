#pragma once

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_graphics/juce_graphics.h>

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <list>
#include <memory>
#include <unordered_map>

namespace arrange::juce {
    struct BitmapCacheCounters {
        std::uint64_t hits = 0;
        std::uint64_t builds = 0;
        std::uint64_t evictions = 0;
        std::size_t retainedBytes = 0;
        std::size_t entries = 0;
        // 仅启用渲染诊断时累计，均为 CPU 调用耗时，不含 GPU 完成时间
        double buildMillis = 0;
        double nativeConvertMillis = 0;
        // 只计成功生成原生图的转换，原本就是原生图与平台回退均不计
        std::uint64_t nativeConversions = 0;
        std::size_t nativeConvertBytes = 0;
    };

    // 重放层的离屏位图缓存：键为不可变片段或资源的身份加参数摘要，按最近使用淘汰，保留字节不超过预算
    // 条目转成平台原生图后入缓存：Direct2D 绘制软件图每次都要重新上传，原生图则驻留 GPU
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

        // 构造时读取环境，渲染路径不重复读取；仅严格的 0 关闭转换、严格的 1 开启诊断
        explicit BitmapCache(std::size_t budgetBytes = 64u * 1024u * 1024u) noexcept : budget_(budgetBytes), nativeEnabled_(!environmentEquals("ARRANGE_BITMAP_NATIVE", "0")), metricsEnabled_(environmentEquals("ARRANGE_RENDER_METRICS", "1")) {}

        template <class Build>
        ::juce::Image get(const Key& key, Build&& build) {
            if (const auto found = index_.find(key); found != index_.end()) {
                entries_.splice(entries_.begin(), entries_, found->second);
                ++counters_.hits;
                return entries_.front().image;
            }
            // 关闭诊断时不读取时钟，既有命中与构建计数仍照常累计
            const auto measure = metricsEnabled_;
            const auto buildStarted = measure ? Clock::now() : Clock::time_point{};
            auto image = build();
            if (measure) counters_.buildMillis += std::chrono::duration<double, std::milli>(Clock::now() - buildStarted).count();
            ++counters_.builds;
            const auto bytes = imageBytes(image);
            // 超过整个预算的位图只用一次，不进缓存
            if (bytes > budget_) return image;
            if (nativeEnabled_ && image.isValid() && !isNative(image)) {
                const auto source = image.getPixelData();
                const auto convertStarted = measure ? Clock::now() : Clock::time_point{};
                image = toNative(image);
                if (measure) {
                    counters_.nativeConvertMillis += std::chrono::duration<double, std::milli>(Clock::now() - convertStarted).count();
                    if (image.isValid() && image.getPixelData() != source && isNative(image)) {
                        ++counters_.nativeConversions;
                        counters_.nativeConvertBytes += imageBytes(image);
                    }
                }
            }
            entries_.push_front({key, image, bytes});
            index_.emplace(key, entries_.begin());
            counters_.retainedBytes += bytes;
            trim();
            return image;
        }

        // 只影响后续新条目的转换，保留既有条目；对比测试应在使用前设置，或先 clear()
        void setNativeEnabled(bool enabled) noexcept {
            nativeEnabled_ = enabled;
        }

        [[nodiscard]] bool nativeEnabled() const noexcept {
            return nativeEnabled_;
        }

        void setMetricsEnabled(bool enabled) noexcept {
            metricsEnabled_ = enabled;
        }

        [[nodiscard]] bool metricsEnabled() const noexcept {
            return metricsEnabled_;
        }

        void setBudget(std::size_t bytes) {
            budget_ = bytes;
            trim();
        }

        void clear() noexcept {
            index_.clear();
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

        // 软件图转平台原生图；已是原生图时原样返回
        static ::juce::Image toNative(const ::juce::Image& image) {
            return image.isValid() ? ::juce::NativeImageType().convert(image) : image;
        }

       private:
        using Clock = std::chrono::steady_clock;

        static bool environmentEquals(const char* name, const char* expected) noexcept {
            const auto* value = std::getenv(name);
            return value && std::strcmp(value, expected) == 0;
        }

        static bool isNative(const ::juce::Image& image) {
            return image.isValid() && image.getPixelData()->createType()->getTypeID() == ::juce::NativeImageType().getTypeID();
        }

        struct Entry {
            Key key;
            ::juce::Image image;
            std::size_t bytes = 0;
        };

        struct KeyHash {
            std::size_t operator()(const Key& key) const noexcept {
                auto hash = static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(key.owner.get()));
                for (const auto part : {key.detail, static_cast<std::uint64_t>(static_cast<std::uint32_t>(key.width)), static_cast<std::uint64_t>(static_cast<std::uint32_t>(key.height))}) {
                    hash = (hash ^ part) * 0x100000001b3ull;
                    hash ^= hash >> 29;
                }
                return static_cast<std::size_t>(hash);
            }
        };

        void trim() {
            while (counters_.retainedBytes > budget_ && !entries_.empty()) {
                counters_.retainedBytes -= entries_.back().bytes;
                index_.erase(entries_.back().key);
                entries_.pop_back();
                ++counters_.evictions;
            }
        }

        std::size_t budget_;
        bool nativeEnabled_;
        bool metricsEnabled_;
        std::list<Entry> entries_;
        std::unordered_map<Key, std::list<Entry>::iterator, KeyHash> index_;
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
