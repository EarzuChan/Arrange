#pragma once

#include "Geometry.h"
#include "LayoutTree.h"

namespace arrange::core {
    struct HitTestResult {
        bool hit = false;
        NodeId node = 0;
        bool clickable = false;
        EventSlotId eventSlot;
        ModifierHandle modifier;
    };

    struct HitConstraint {
        ModifierInstance geometry;
        std::size_t parent = 0;
    };

    struct HitRegion {
        Rect bounds;
        HitTestResult target;
        std::size_t constraint = 0;
    };

    struct HitTestSnapshot {
        // constraint 0 是根哨兵，其他索引指向 constraints[index - 1]。
        std::vector<HitConstraint> constraints;
        std::vector<HitRegion> regions;
    };

    HitTestSnapshot buildHitTestSnapshot(const LayoutTree& tree, NodeId root);

    class HitTester {
    public:
        HitTestResult hitTest(const HitTestSnapshot& snapshot, Point point) const;
        HitTestResult hitTestClickable(const HitTestSnapshot& snapshot, Point point) const;
        HitTestResult hitTest(const LayoutTree& tree, NodeId root, Point point) const;
        HitTestResult hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const;

    };
} // namespace arrange::core
