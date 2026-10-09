#pragma once

#include "Geometry.h"
#include "ImmutableVector.h"
#include "LazyGeometryIndex.h"
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace arrange::core {
    class LazyKeyIndex {
       public:
        using Values = std::unordered_map<std::string, int>;

        LazyKeyIndex() : values_(std::make_shared<const Values>()) {}

        LazyKeyIndex& operator=(Values values) {
            values_ = std::make_shared<const Values>(std::move(values));
            return *this;
        }

        auto find(const std::string& key) const {
            return values_->find(key);
        }

        auto end() const {
            return values_->end();
        }

       private:
        std::shared_ptr<const Values> values_;
    };

    struct LazyVisibleItem {
        int index = 0;
        float offset = 0;
        float size = 0;
        int span = 1;
        bool operator==(const LazyVisibleItem&) const = default;
    };

    struct LazyScrollSnapshot {
        int firstVisibleItemIndex = 0;
        float firstVisibleItemScrollOffset = 0;
        int totalItemsCount = 0;
        bool needsMoreItems = false;
        std::uint64_t workGeneration = 0;
        std::vector<LazyVisibleItem> visibleItems;
        bool operator==(const LazyScrollSnapshot&) const = default;
    };

    // 候选树复制时按需复制，失败测量不会改写已发布的索引或缓存
    struct LazyLayoutState {
        struct Measurement {
            float main = 0;
            std::string contentType;
            std::uint64_t used = 0;
            int line = 0;
            float crossConstraint = 0;
        };

        std::uint64_t version = 0;
        std::uint64_t requestVersion = 0;
        std::uint64_t clock = 0;
        std::uint64_t workGeneration = 0;
        std::uint64_t measurementCacheHits = 0;
        int cells = 1;
        float crossSize = -1;
        float estimate = 48;
        float spacing = 0;
        float crossSpacing = 0;
        float contentSize = 0;
        float viewportSize = 0;
        float scrollOffset = 0;
        float anchorOffset = 0;
        std::string anchorKey;
        std::vector<std::string> pinnedKeys;
        std::string focusRequestKey;
        std::uint64_t focusRequestVersion = 0;
        std::uint64_t consumedFocusRequestVersion = 0;
        ImmutableVector<std::string> keys;
        ImmutableVector<std::string> contentTypes;
        LazyKeyIndex keyToIndex;
        LazyGeometryIndex itemMainSizes;
        ImmutableVector<int> itemLines;
        ImmutableVector<int> itemSlots;
        ImmutableVector<int> itemSpans;
        ImmutableVector<std::vector<int>> lines;
        LazyGeometryIndex prefixDeltas;
        LazyGeometryIndex lineMainSizes;
        std::unordered_map<std::string, Measurement> measurements;
        LazyScrollSnapshot snapshot;
        LazyScrollSnapshot publishedSnapshot;
    };
}
