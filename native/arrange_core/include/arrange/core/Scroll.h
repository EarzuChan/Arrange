#pragma once

#include "Geometry.h"
#include "RenderTree.h"

#include <cstdint>

namespace arrange::core {
    struct ScrollResult {
        bool consumed = false;
        NodeId target = 0;
        float value = 0.0f;
        float maxValue = 0.0f;
        float viewportSize = 0.0f;
        float contentSize = 0.0f;
        std::uint32_t callbackHandle = 0;
    };

    class ScrollDispatcher {
    public:
        ScrollResult verticalWheel(RenderTree& tree, NodeId root, Point point, float wheelDeltaY, float pixelsPerWheelUnit = 48.0f) const;
        ScrollResult horizontalWheel(RenderTree& tree, NodeId root, Point point, float wheelDeltaX, float pixelsPerWheelUnit = 48.0f) const;

    private:
        static bool hasVerticalScroll(const ArrangeNode& node);
        static bool hasHorizontalScroll(const ArrangeNode& node);
        static float verticalScrollValue(const ArrangeNode& node);
        static float horizontalScrollValue(const ArrangeNode& node);
        static void setVerticalScrollValue(ArrangeNode& node, float value);
        static void setHorizontalScrollValue(ArrangeNode& node, float value);
        static float verticalContentHeight(const RenderTree& tree, const ArrangeNode& node);
        static float horizontalContentWidth(const RenderTree& tree, const ArrangeNode& node);
        static std::uint32_t nativeScrollCallbackHandle(const ArrangeNode& node, const char* nativeProp);
        static NodeId findVerticalScrollTarget(const RenderTree& tree, NodeId id, Point point, NodeId fallback);
        static NodeId findHorizontalScrollTarget(const RenderTree& tree, NodeId id, Point point, NodeId fallback);
    };
} // namespace arrange::core
