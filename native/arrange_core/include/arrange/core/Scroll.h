#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "LayoutTree.h"
#include <unordered_map>

namespace arrange::core {
    using PendingScrollValues = std::unordered_map<std::uint64_t, float>;

    struct ScrollResult {
        bool consumed = false;
        NodeId target = 0;
        float value = 0.0f;
        float maxValue = 0.0f;
        float viewportSize = 0.0f;
        float contentSize = 0.0f;
        EventSlotId eventSlot;
        ModifierHandle modifier;
    };

    class ScrollDispatcher {
    public:
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
} // namespace arrange::core
