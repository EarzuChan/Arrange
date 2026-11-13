#pragma once

#if ARRANGE_JUCE_WITH_JUCE
#include <arrange/core/Paint.h>
#include <juce_graphics/juce_graphics.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

namespace arrange::juce {
    struct ScrollTileCounters {
        // 以图块绘制与回退为直接绘制的滚动层次数
        std::uint64_t layersTiled = 0;
        std::uint64_t layersDirect = 0;
        // 因内容持续大面积变化而降级的次数，已计入 layersDirect
        std::uint64_t demotions = 0;
        std::uint64_t tileHits = 0;
        std::uint64_t tileBuilds = 0;
        // 内容局部变化时只清掉并重放变化那一块的图块次数
        std::uint64_t tilesRepainted = 0;
        std::uint64_t tilesInvalidated = 0;
        std::uint64_t tilesEvicted = 0;
        std::size_t retainedBytes = 0;
        std::size_t tiles = 0;
    };

    // 滚动层的图块缓存：内容坐标系中的方格位图，按滚动层身份分组，按最近使用淘汰
    class ScrollTileCache {
       public:
        static constexpr int tilePixels = 512;
        static constexpr std::size_t tileBytes = static_cast<std::size_t>(tilePixels) * tilePixels * 4;

        struct Tile {
            ::juce::Image image;
            std::uint64_t used = 0;
            // 内容坐标系中待重画的范围；下次用到该图块时只重画这些范围
            std::vector<::juce::Rectangle<float>> dirty;
        };

        struct Layer {
            // 持有层身份，保证缓存期间地址不被复用
            std::shared_ptr<const arrange::core::PaintLayerFragment> identity;
            std::shared_ptr<const arrange::core::PaintFragment> content;
            float scale = 0;
            // 图块网格在内容坐标系中的锚点，对齐物理像素；图块为空时可重新锚定
            float gridX = 0;
            float gridY = 0;
            // 连续多少次绘制里一半以上的可见图块要重建
            int churn = 0;
            bool hasBackdrop = false;
            bool hasInput = false;
            std::unordered_map<std::uint64_t, Tile> tiles;
        };

        explicit ScrollTileCache(std::size_t budgetBytes = 96u * 1024u * 1024u) noexcept : budget_(budgetBytes) {}

        static std::uint64_t pack(int x, int y) noexcept {
            return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(x)) << 32) | static_cast<std::uint32_t>(y);
        }

        Layer& layer(const std::shared_ptr<const arrange::core::PaintLayerFragment>& identity) {
            const auto key = identity.get();
            if (const auto found = layers_.find(key); found != layers_.end()) return found->second;
            // 滚动层随布局重建而更替，没有图块的旧层顺带清掉
            if (layers_.size() >= 64)
                for (auto it = layers_.begin(); it != layers_.end();) it = it->second.tiles.empty() ? layers_.erase(it) : std::next(it);
            auto& created = layers_[key];
            created.identity = identity;
            return created;
        }

        std::uint64_t touch() noexcept {
            return ++tick_;
        }

        void added() noexcept {
            ++tileCount_;
            ++counters_.tileBuilds;
        }

        // 图块内容坐标系中的一块范围变了：记为待重画；累计面积超过图块的六成时不如整块重建，直接失效
        void markDirty(Layer& layer, std::uint64_t key, ::juce::Rectangle<float> piece, float tileArea) {
            const auto found = layer.tiles.find(key);
            if (found == layer.tiles.end() || piece.isEmpty()) return;
            auto& dirty = found->second.dirty;
            dirty.push_back(piece);
            if (dirty.size() > 6) {
                auto bounds = dirty.front();
                for (const auto& other : dirty) bounds = bounds.getUnion(other);
                dirty.assign(1, bounds);
            }
            auto area = 0.0f;
            for (const auto& other : dirty) area += other.getWidth() * other.getHeight();
            if (area >= tileArea * 0.6f) erase(layer, key);
        }

        void erase(Layer& layer, std::uint64_t key) {
            if (layer.tiles.erase(key) == 0) return;
            --tileCount_;
            ++counters_.tilesInvalidated;
        }

        void clear(Layer& layer) {
            tileCount_ -= layer.tiles.size();
            counters_.tilesInvalidated += layer.tiles.size();
            layer.tiles.clear();
        }

        void trim() {
            while (tileCount_ * tileBytes > budget_ && tileCount_ > 0) {
                Layer* owner = nullptr;
                std::uint64_t oldestKey = 0, oldest = ~std::uint64_t{0};
                for (auto& entry : layers_)
                    for (const auto& tile : entry.second.tiles)
                        if (tile.second.used < oldest) {
                            oldest = tile.second.used;
                            oldestKey = tile.first;
                            owner = &entry.second;
                        }
                if (!owner) break;
                owner->tiles.erase(oldestKey);
                --tileCount_;
                ++counters_.tilesEvicted;
            }
        }

        void setBudget(std::size_t bytes) {
            budget_ = bytes;
            trim();
        }

        [[nodiscard]] std::size_t budget() const noexcept {
            return budget_;
        }

        [[nodiscard]] ScrollTileCounters counters() const noexcept {
            auto result = counters_;
            result.tiles = tileCount_;
            result.retainedBytes = tileCount_ * tileBytes;
            return result;
        }

        ScrollTileCounters& mutableCounters() noexcept {
            return counters_;
        }

       private:
        std::size_t budget_;
        std::uint64_t tick_ = 0;
        std::size_t tileCount_ = 0;
        std::unordered_map<const arrange::core::PaintLayerFragment*, Layer> layers_;
        ScrollTileCounters counters_;
    };
}
#endif
