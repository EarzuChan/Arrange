#pragma once

#include "Geometry.h"
#include "RenderTree.h"

namespace arrange::core {
    struct HitTestResult {
        bool hit = false;
        NodeId node = 0;
        bool clickable = false;
    };

    class HitTester {
    public:
        HitTestResult hitTest(const RenderTree& tree, NodeId root, Point point) const;
        HitTestResult hitTestClickable(const RenderTree& tree, NodeId root, Point point) const;

    private:
        static bool contains(Rect rect, Point point) noexcept;
        static bool wantsClick(const ArrangeNode& node);
    };
} // namespace arrange::core
