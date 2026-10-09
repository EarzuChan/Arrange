#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "HitTest.h"
#include "LayoutTree.h"
#include "SlotUpdate.h"

namespace arrange::core {
    struct PointerDispatchResult {
        bool consumed = false;
        bool clickTriggered = false;
        NodeId target = 0;
        EventSlotId eventSlot;
    };

    class PointerInputProcessor {
       public:
        PointerDispatchResult pointerDown(const HitTestSnapshot& snapshot, Point point, int pointerId = 0);
        PointerDispatchResult pointerUp(const HitTestSnapshot& snapshot, Point point, int pointerId = 0);
        PointerDispatchResult pointerDown(const LayoutTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerUp(const LayoutTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerCancel(int pointerId = 0) noexcept;

        std::optional<NodeId> capturedNode(const LayoutTree& tree) const {
            if (!pressed_.id || !tree.contains(pressed_.id) || tree.node(pressed_.id).generation != pressed_.generation || !tree.node(pressed_.id).modifier.find(pressedModifier_)) return {};
            return pressed_.id;
        }

       private:
        int activePointerId_ = -1;
        NodeHandle pressed_;
        EventSlotId pressedEventSlot_;
        ModifierHandle pressedModifier_;
        HitTester hitTester_;
    };
}
