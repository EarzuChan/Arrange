#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/Modifier.h>

namespace arrange::core {
    EventSlotId PointerInputProcessor::clickEventSlot(const ArrangeNode& node) {
        return node.modifier.input.clickEventSlot;
    }

    PointerDispatchResult PointerInputProcessor::pointerDown(const LayoutTree& tree, NodeId root, Point point, int pointerId) {
        const auto hit = hitTester_.hitTestClickable(tree, root, point);
        if (!hit.hit) {
            activePointerId_ = -1;
            pressedNode_ = 0;
            pressedEventSlot_ = {};
            return {};
        }

        activePointerId_ = pointerId;
        pressedNode_ = hit.node;
        pressedEventSlot_ = clickEventSlot(tree.node(hit.node));
        return {true, false, hit.node, pressedEventSlot_};
    }

    PointerDispatchResult PointerInputProcessor::pointerUp(const LayoutTree& tree, NodeId root, Point point, int pointerId) {
        if (activePointerId_ != pointerId || pressedNode_ == 0) return {};

        const auto pressed = pressedNode_;
        const auto eventSlot = pressedEventSlot_;
        activePointerId_ = -1;
        pressedNode_ = 0;
        pressedEventSlot_ = {};

        const auto hit = hitTester_.hitTestClickable(tree, root, point);
        if (hit.hit && hit.node == pressed) return {true, true, pressed, eventSlot};
        return {true, false, pressed, eventSlot};
    }

    PointerDispatchResult PointerInputProcessor::pointerCancel(int pointerId) noexcept {
        if (activePointerId_ != pointerId || pressedNode_ == 0) return {};
        const auto pressed = pressedNode_;
        const auto eventSlot = pressedEventSlot_;
        activePointerId_ = -1;
        pressedNode_ = 0;
        pressedEventSlot_ = {};
        return {true, false, pressed, eventSlot};
    }
} // namespace arrange::core
