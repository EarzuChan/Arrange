#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "LayoutTree.h"
#include "LazyLayout.h"
#include <unordered_map>
#include <vector>

namespace arrange::core {
    using PendingScrollValues = std::unordered_map<std::uint64_t, float>;

    struct ScrollTarget {
        NodeId node = 0;
        ModifierHandle modifier;
        bool horizontal = false;
    };

    using ScrollHitPath = std::vector<ScrollTarget>;

    struct ScrollResult : ScrollSnapshot {
        bool consumed = false;
        NodeId target = 0;
        EventSlotId eventSlot;
        ModifierHandle modifier;
        std::optional<LazyScrollSnapshot> lazy;
    };

    class ScrollDispatcher {
       public:
        static ScrollSnapshot snapshot(const ModifierInstance& instance);
        static ScrollHitPath hitPath(const LayoutTree& tree, NodeId root, Point point);
        static ScrollResult targetWheel(const LayoutTree& tree, const ScrollTarget& target, float delta, float pixelsPerWheelUnit = 48.0f, const PendingScrollValues* pending = nullptr);
        ScrollResult verticalWheel(const LayoutTree& tree, NodeId root, Point point, float wheelDeltaY, float pixelsPerWheelUnit = 48.0f, const PendingScrollValues* pending = nullptr) const;
        ScrollResult horizontalWheel(const LayoutTree& tree, NodeId root, Point point, float wheelDeltaX, float pixelsPerWheelUnit = 48.0f, const PendingScrollValues* pending = nullptr) const;
        static bool hasVerticalScroll(const LayoutNode& node);
        static bool hasHorizontalScroll(const LayoutNode& node);
        static float verticalScrollValue(const LayoutNode& node);
        static float horizontalScrollValue(const LayoutNode& node);
        static float verticalContentHeight(const LayoutTree& tree, const LayoutNode& node);
        static float horizontalContentWidth(const LayoutTree& tree, const LayoutNode& node);
        static EventSlotId nativeScrollEventSlot(const LayoutNode& node, EventSlotKind kind);
        static NodeId findVerticalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback);
        static NodeId findHorizontalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback);
    };
}
