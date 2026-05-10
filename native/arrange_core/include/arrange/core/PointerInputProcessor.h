#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "HitTest.h"
#include "LayoutTree.h"

namespace arrange::core {
    struct PointerDispatchResult {
        bool consumed = false;
        bool clickTriggered = false;
        NodeId target = 0;
        EventSlotId eventSlot;
    };

    class PointerInputProcessor {
    public:
        PointerDispatchResult pointerDown(const LayoutTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerUp(const LayoutTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerCancel(int pointerId = 0) noexcept;

    private:
        static EventSlotId clickEventSlot(const ArrangeNode& node);

        int activePointerId_ = -1;
        NodeId pressedNode_ = 0;
        EventSlotId pressedEventSlot_;
        HitTester hitTester_;
    };
} // namespace arrange::core
