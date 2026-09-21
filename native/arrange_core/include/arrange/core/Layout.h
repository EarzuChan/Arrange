#pragma once

#include "Geometry.h"
#include "Modifier.h"
#include "LayoutTree.h"
#include "Scroll.h"
#include <vector>

namespace arrange::core {
    class TextLayoutService;

    struct LayoutWorkCounters {
        std::uint64_t animationSamples = 0;
        std::uint64_t measuredNodes = 0;
        std::uint64_t measureCacheHits = 0;
        std::uint64_t placedNodes = 0;
        std::uint64_t placeCacheHits = 0;
    };

    class LayoutEngine {
       public:
        LayoutEngine();
        explicit LayoutEngine(const TextLayoutService& textLayoutService);

        const TextLayoutService& textLayoutService() const noexcept {
            return *textLayoutService_;
        }

        const LayoutWorkCounters& counters() const noexcept {
            return counters_;
        }

        void resetCounters() noexcept {
            counters_ = {};
        }

        void layout(LayoutTree& tree, NodeId root, Constraints constraints);
        Size measure(LayoutTree& tree, NodeId id, Constraints constraints);
        void place(LayoutTree& tree, NodeId id, float x = 0.0f, float y = 0.0f);
        std::vector<ScrollResult> takeScrollUpdates();

       private:
        Size measureWithModifier(LayoutTree& tree, NodeId id, std::size_t index, Constraints constraints);
        Size measureContent(LayoutTree& tree, NodeId id, Constraints constraints);
        void placeWithModifier(LayoutTree& tree, NodeId id, std::size_t index, float x, float y);
        void placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height);

        LayoutWorkCounters counters_;
        std::vector<ScrollResult> scrollUpdates_;
        const TextLayoutService* textLayoutService_ = nullptr;
    };
}  // namespace arrange::core
